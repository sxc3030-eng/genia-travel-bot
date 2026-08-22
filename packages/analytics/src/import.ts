import { readFile } from 'node:fs/promises';
import { config, logger } from '@genia/core';
import { query } from '@genia/core/db';
import { parseCsvRecords } from './csv.js';

export type Network = 'partnerize' | 'impact';

export interface ConversionRecord {
  externalId: string;
  subid: string;
  bookingValue: number;
  commission: number;
  currency: string;
  status: ConversionStatus;
  bookedAt: Date;
}

/**
 * Normalised across networks. Only `approved` and `paid` are real money;
 * `pending` may still be rejected, and `rejected` is a cancelled or fraudulent
 * booking. Counting those as revenue is how an affiliate dashboard ends up
 * promising numbers that never arrive.
 */
export type ConversionStatus = 'pending' | 'approved' | 'paid' | 'rejected';

/**
 * Column names per network.
 *
 * These follow each network's documented report export. Verify them against a
 * real export before the first production import — a renamed column surfaces
 * as a skipped row, and `importConversions` reports skipped rows rather than
 * failing silently.
 */
export const COLUMN_MAPS: Record<Network, Record<keyof ConversionRecord, string[]>> = {
  partnerize: {
    externalId: ['conversion_id', 'conversion_reference'],
    subid: ['publisher_reference', 'pub_ref', 'subid'],
    bookingValue: ['sale_value', 'conversion_value'],
    commission: ['publisher_commission', 'commission'],
    currency: ['currency', 'conversion_currency'],
    status: ['conversion_status', 'status'],
    bookedAt: ['conversion_time', 'conversion_date'],
  },
  impact: {
    externalId: ['action_id', 'id'],
    subid: ['subid1', 'sub_id1', 'shared_id'],
    bookingValue: ['sale_amount', 'amount'],
    commission: ['payout', 'commission'],
    currency: ['currency'],
    status: ['status', 'action_status'],
    bookedAt: ['event_date', 'action_date'],
  },
};

const STATUS_ALIASES: Record<string, ConversionStatus> = {
  pending: 'pending',
  open: 'pending',
  received: 'pending',
  approved: 'approved',
  confirmed: 'approved',
  validated: 'approved',
  locked: 'approved',
  paid: 'paid',
  cleared: 'paid',
  rejected: 'rejected',
  declined: 'rejected',
  cancelled: 'rejected',
  canceled: 'rejected',
  returned: 'rejected',
};

export function normaliseStatus(raw: string): ConversionStatus | null {
  return STATUS_ALIASES[raw.trim().toLowerCase()] ?? null;
}

function pick(record: Record<string, string>, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const value = record[candidate];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

/** Handles "1 234,56", "$1,234.56" and plain "1234.56" alike. */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^\d,.\-]/g, '').trim();
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  let normalised: string;
  if (lastComma > lastDot) {
    // Comma is the decimal separator: strip dots and spaces used as grouping.
    normalised = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    normalised = cleaned.replace(/,/g, '');
  }

  const value = Number(normalised);
  return Number.isFinite(value) ? value : null;
}

export interface MappedRow {
  record?: ConversionRecord;
  skipped?: { reason: string; raw: Record<string, string> };
}

export function mapRow(record: Record<string, string>, network: Network): MappedRow {
  const map = COLUMN_MAPS[network];

  const externalId = pick(record, map.externalId);
  const subid = pick(record, map.subid);
  const statusRaw = pick(record, map.status);
  const bookedAtRaw = pick(record, map.bookedAt);

  if (!externalId) return { skipped: { reason: 'missing external id', raw: record } };
  // A conversion with no subid cannot be attributed to an offer, so it is not
  // ours to count — another publisher's row, or a direct booking.
  if (!subid) return { skipped: { reason: 'missing subid', raw: record } };
  if (!bookedAtRaw) return { skipped: { reason: 'missing booked_at', raw: record } };

  const bookedAt = new Date(bookedAtRaw);
  if (Number.isNaN(bookedAt.getTime())) return { skipped: { reason: 'unparseable date', raw: record } };

  const status = normaliseStatus(statusRaw ?? '');
  if (!status) return { skipped: { reason: `unknown status "${statusRaw}"`, raw: record } };

  const bookingValue = parseAmount(pick(record, map.bookingValue) ?? '');
  const commission = parseAmount(pick(record, map.commission) ?? '');
  if (bookingValue === null || commission === null) {
    return { skipped: { reason: 'unparseable amount', raw: record } };
  }

  const currency = (pick(record, map.currency) ?? 'CAD').trim().toUpperCase();

  return {
    record: { externalId, subid: subid.trim(), bookingValue, commission, currency, status, bookedAt },
  };
}

export interface ImportSummary {
  parsed: number;
  imported: number;
  updated: number;
  skipped: Array<{ reason: string }>;
  outOfRange: number;
  unmatchedSubids: number;
}

export interface ImportOptions {
  csv: string;
  network?: Network;
  from?: Date;
  to?: Date;
}

/**
 * Upserts on (network, external_id) so re-importing an overlapping report
 * updates a conversion's status instead of inserting it a second time.
 */
export async function importConversionsFromCsv(options: ImportOptions): Promise<ImportSummary> {
  const network = options.network ?? (config.expedia.network as Network);
  const records = parseCsvRecords(options.csv);

  const summary: ImportSummary = {
    parsed: records.length,
    imported: 0,
    updated: 0,
    skipped: [],
    outOfRange: 0,
    unmatchedSubids: 0,
  };

  for (const raw of records) {
    const { record, skipped } = mapRow(raw, network);
    if (!record) {
      summary.skipped.push({ reason: skipped!.reason });
      continue;
    }

    if (options.from && record.bookedAt < options.from) {
      summary.outOfRange++;
      continue;
    }
    if (options.to && record.bookedAt > options.to) {
      summary.outOfRange++;
      continue;
    }

    const matched = await query('SELECT 1 FROM offers WHERE subid = $1', [record.subid]);
    if (matched.rowCount === 0) summary.unmatchedSubids++;

    const result = await query<{ inserted: boolean }>(
      `INSERT INTO conversions (network, external_id, subid, booking_value, commission, currency, status, booked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (network, external_id) DO UPDATE
         SET status = EXCLUDED.status,
             booking_value = EXCLUDED.booking_value,
             commission = EXCLUDED.commission,
             currency = EXCLUDED.currency,
             booked_at = EXCLUDED.booked_at
       RETURNING (xmax = 0) AS inserted`,
      [
        network,
        record.externalId,
        record.subid,
        record.bookingValue,
        record.commission,
        record.currency,
        record.status,
        record.bookedAt,
      ]
    );

    if (result.rows[0]?.inserted) summary.imported++;
    else summary.updated++;
  }

  logger.info('conversion import complete', { network, ...summary, skipped: summary.skipped.length });
  return summary;
}

/** Contract from plan section 5: importConversions(from, to) -> count imported. */
export async function importConversions(from: Date, to: Date, csvPath?: string): Promise<number> {
  const path = csvPath ?? process.env.CONVERSIONS_CSV_PATH;
  if (!path) throw new Error('A CSV path is required (argument or CONVERSIONS_CSV_PATH)');

  const csv = await readFile(path, 'utf8');
  const summary = await importConversionsFromCsv({ csv, from, to });
  return summary.imported + summary.updated;
}
