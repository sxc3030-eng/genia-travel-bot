import { config, logger, type EventSource, type RawEvent } from '@genia/core';
import { query } from '@genia/core/db';
import { buildDedupeKey, dedupeBatch, isNearDuplicate, slugify } from './dedupe.js';
import { originCitiesFor, scoreEvent, type ScoringOptions } from './scoring.js';

export { buildDedupeKey, dedupeBatch, isNearDuplicate, slugify } from './dedupe.js';
export * from './scoring.js';
export { TicketmasterSource, mapTicketmasterEvent, mapCategory } from './sources/ticketmaster.js';

const NORTH_AMERICA = new Set(['CA', 'US', 'MX']);

export interface ScanResult {
  fetched: number;
  afterGeoFilter: number;
  afterDedupe: number;
  inserted: number;
  skippedExisting: number;
  /** Skipped because a prior run already stored a near-identical listing. */
  skippedNearDuplicate: number;
}

/**
 * Catches the duplicate a previous run already stored, which the in-batch
 * `dedupeBatch` cannot see and the exact UNIQUE key does not match (e.g. one
 * source appends promo text the other omits).
 */
async function findExistingNearDuplicate(event: RawEvent): Promise<string | null> {
  // Half-open UTC-day range, matching `eventDateKey`'s UTC semantics and
  // keeping the lookup on a plain btree index (see migration 002).
  const dayStart = new Date(Date.UTC(
    event.startsAt.getUTCFullYear(),
    event.startsAt.getUTCMonth(),
    event.startsAt.getUTCDate()
  ));
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);

  const existing = await query<{ dedupe_key: string; title: string }>(
    `SELECT dedupe_key, title FROM events WHERE city = $1 AND starts_at >= $2 AND starts_at < $3`,
    [event.city, dayStart, dayEnd]
  );

  const candidateSlug = slugify(event.title);
  const match = existing.rows.find((row) => isNearDuplicate(slugify(row.title), candidateSlug));
  return match ? match.dedupe_key : null;
}

/** GEO_SCOPE=north_america drops anything outside CA/US/MX. */
export function applyGeoScope(events: RawEvent[], geoScope: 'north_america' | 'world'): RawEvent[] {
  if (geoScope === 'world') return events;
  return events.filter((e) => NORTH_AMERICA.has(e.country.toUpperCase()));
}

/**
 * Étage 1: fetch -> geo filter -> dedupe -> score -> persist as `new`.
 * Rows land with status 'new'; nothing is published from here.
 */
export async function runScan(source: EventSource): Promise<ScanResult> {
  const fetched = await source.fetch();
  const scoped = applyGeoScope(fetched, config.geoScope);
  const deduped = dedupeBatch(scoped);

  const scoringOptions: ScoringOptions = {
    originCities: originCitiesFor(config.originAirports),
    publishWindow: config.publishWindow,
  };

  let inserted = 0;
  let skippedExisting = 0;
  let skippedNearDuplicate = 0;

  for (const event of deduped) {
    const nearDuplicate = await findExistingNearDuplicate(event);
    if (nearDuplicate) {
      skippedNearDuplicate++;
      logger.debug('skipping near-duplicate of an already stored event', {
        title: event.title,
        existing: nearDuplicate,
      });
      continue;
    }

    const result = await query(
      `INSERT INTO events (dedupe_key, title, category, city, country, venue, capacity, starts_at, ends_at, source, source_url, score, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'new')
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        buildDedupeKey(event),
        event.title,
        event.category,
        event.city,
        event.country,
        event.venue,
        event.capacity ?? null,
        event.startsAt,
        event.endsAt ?? null,
        source.name,
        event.sourceUrl,
        scoreEvent(event, scoringOptions),
      ]
    );
    if (result.rowCount) inserted++;
    else skippedExisting++;
  }

  const summary: ScanResult = {
    fetched: fetched.length,
    afterGeoFilter: scoped.length,
    afterDedupe: deduped.length,
    inserted,
    skippedExisting,
    skippedNearDuplicate,
  };

  logger.info('scan complete', { source: source.name, ...summary });
  return summary;
}
