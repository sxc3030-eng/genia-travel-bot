import { query } from '@genia/core/db';

/**
 * Revenue counts only conversions the network has actually validated.
 * `pending` may still be rejected and `rejected` is money that never existed —
 * folding either into revenue produces a dashboard that promises income which
 * never arrives. Pending is reported alongside, not inside, the total.
 */
export const REVENUE_STATUSES = ['approved', 'paid'] as const;

export interface RevenueByCurrency {
  currency: string;
  bookingValue: number;
  revenue: number;
}

export interface ReportRow {
  dimension: string;
  events: number;
  offers: number;
  clicks: number;
  conversions: number;
  pendingConversions: number;
  rejectedConversions: number;
  /**
   * Broken out per currency and never summed across them: adding CAD to USD
   * yields a number that means nothing and looks perfectly plausible.
   */
  revenue: RevenueByCurrency[];
  /** Conversions per click, as a percentage. Null when there are no clicks. */
  conversionRate: number | null;
  /**
   * Revenue per click — the number that actually ranks dimensions. Null when
   * there are no clicks, or when several currencies are present and a single
   * figure would be meaningless.
   */
  revenuePerClick: number | null;
  revenuePerClickCurrency: string | null;
}

export interface ReportOptions {
  from?: Date;
  to?: Date;
  groupBy?: 'category' | 'origin' | 'city';
}

const GROUP_COLUMNS = {
  category: 'e.category',
  origin: 'o.origin',
  city: 'e.city',
} as const;

interface CountsRow {
  dimension: string;
  events: string;
  offers: string;
  clicks: string;
  conversions: string;
  pending_conversions: string;
  rejected_conversions: string;
}

interface RevenueRow {
  dimension: string;
  currency: string;
  booking_value: string;
  revenue: string;
}

/**
 * The phase 5 milestone table: dimension -> clicks -> conversions -> revenue.
 *
 * Counts and revenue are queried separately on purpose. Grouping the counts by
 * currency as well would split one dimension across several rows whenever some
 * of its offers have converted and others have not — and the conversion rate
 * would then be wrong on every one of those rows, because the clicks were
 * divided between them while the conversions were not.
 *
 * Clicks and conversions are each pre-aggregated per offer before joining, so
 * the join cannot multiply them together (three clicks and two conversions on
 * one offer must not report six of each).
 */
export async function buildReport(options: ReportOptions = {}): Promise<ReportRow[]> {
  const groupBy = options.groupBy ?? 'category';
  const groupColumn = GROUP_COLUMNS[groupBy];
  const params = [options.from ?? null, options.to ?? null];

  const counts = await query<CountsRow>(
    `WITH offer_clicks AS (
       SELECT offer_id, count(*) AS clicks
       FROM clicks
       WHERE ($1::timestamptz IS NULL OR clicked_at >= $1)
         AND ($2::timestamptz IS NULL OR clicked_at <= $2)
       GROUP BY offer_id
     ),
     offer_conversions AS (
       SELECT o.id AS offer_id,
              count(*) FILTER (WHERE c.status IN ('approved','paid')) AS conversions,
              count(*) FILTER (WHERE c.status = 'pending') AS pending_conversions,
              count(*) FILTER (WHERE c.status = 'rejected') AS rejected_conversions
       FROM conversions c
       JOIN offers o ON o.subid = c.subid
       WHERE ($1::timestamptz IS NULL OR c.booked_at >= $1)
         AND ($2::timestamptz IS NULL OR c.booked_at <= $2)
       GROUP BY o.id
     )
     SELECT ${groupColumn} AS dimension,
            count(DISTINCT e.id) AS events,
            count(DISTINCT o.id) AS offers,
            coalesce(sum(cl.clicks), 0) AS clicks,
            coalesce(sum(oc.conversions), 0) AS conversions,
            coalesce(sum(oc.pending_conversions), 0) AS pending_conversions,
            coalesce(sum(oc.rejected_conversions), 0) AS rejected_conversions
     FROM offers o
     JOIN events e ON e.id = o.event_id
     LEFT JOIN offer_clicks cl ON cl.offer_id = o.id
     LEFT JOIN offer_conversions oc ON oc.offer_id = o.id
     GROUP BY ${groupColumn}`,
    params
  );

  const revenue = await query<RevenueRow>(
    `SELECT ${groupColumn} AS dimension,
            c.currency,
            coalesce(sum(c.booking_value), 0) AS booking_value,
            coalesce(sum(c.commission), 0) AS revenue
     FROM conversions c
     JOIN offers o ON o.subid = c.subid
     JOIN events e ON e.id = o.event_id
     WHERE c.status IN ('approved','paid')
       AND ($1::timestamptz IS NULL OR c.booked_at >= $1)
       AND ($2::timestamptz IS NULL OR c.booked_at <= $2)
     GROUP BY ${groupColumn}, c.currency`,
    params
  );

  const revenueByDimension = new Map<string, RevenueByCurrency[]>();
  for (const row of revenue.rows) {
    const list = revenueByDimension.get(row.dimension) ?? [];
    list.push({
      currency: row.currency,
      bookingValue: Number(row.booking_value),
      revenue: Number(row.revenue),
    });
    revenueByDimension.set(row.dimension, list);
  }

  const rows: ReportRow[] = counts.rows.map((row) => {
    const clicks = Number(row.clicks);
    const conversions = Number(row.conversions);
    const revenueRows = (revenueByDimension.get(row.dimension) ?? []).sort((a, b) => b.revenue - a.revenue);

    const singleCurrency = revenueRows.length === 1 ? revenueRows[0] : null;

    return {
      dimension: row.dimension,
      events: Number(row.events),
      offers: Number(row.offers),
      clicks,
      conversions,
      pendingConversions: Number(row.pending_conversions),
      rejectedConversions: Number(row.rejected_conversions),
      revenue: revenueRows,
      conversionRate: clicks > 0 ? (conversions / clicks) * 100 : null,
      revenuePerClick: singleCurrency && clicks > 0 ? singleCurrency.revenue / clicks : null,
      revenuePerClickCurrency: singleCurrency?.currency ?? null,
    };
  });

  return rows.sort((a, b) => {
    const aRevenue = a.revenue.reduce((sum, r) => sum + r.revenue, 0);
    const bRevenue = b.revenue.reduce((sum, r) => sum + r.revenue, 0);
    if (aRevenue !== bRevenue) return bRevenue - aRevenue;
    return b.clicks - a.clicks;
  });
}

function formatRevenue(revenue: RevenueByCurrency[]): string {
  if (revenue.length === 0) return '—';
  return revenue.map((r) => `${r.revenue.toFixed(2)} ${r.currency}`).join(' + ');
}

/** Renders the report as a fixed-width table. */
export function formatReport(rows: ReportRow[], dimensionLabel = 'catégorie'): string {
  if (rows.length === 0) return 'Aucune donnée.';

  const columns = [
    dimensionLabel.padEnd(14),
    'events'.padStart(6),
    'offres'.padStart(6),
    'clics'.padStart(6),
    'conv.'.padStart(6),
    'att.'.padStart(5),
    'rej.'.padStart(5),
    'taux'.padStart(7),
    'revenu'.padStart(20),
    'rev/clic'.padStart(10),
  ];
  const header = columns.join(' ');

  const lines = rows.map((row) =>
    [
      row.dimension.slice(0, 14).padEnd(14),
      String(row.events).padStart(6),
      String(row.offers).padStart(6),
      String(row.clicks).padStart(6),
      String(row.conversions).padStart(6),
      String(row.pendingConversions).padStart(5),
      String(row.rejectedConversions).padStart(5),
      (row.conversionRate === null ? '—' : `${row.conversionRate.toFixed(1)} %`).padStart(7),
      formatRevenue(row.revenue).padStart(20),
      (row.revenuePerClick === null ? '—' : row.revenuePerClick.toFixed(3)).padStart(10),
    ].join(' ')
  );

  const multiCurrency = rows.filter((row) => row.revenue.length > 1);
  const footer = multiCurrency.length
    ? `\nNote : ${multiCurrency.length} ligne(s) en plusieurs devises — les revenus ne sont jamais additionnés entre devises, et rev/clic est laissé vide dans ce cas.`
    : '';

  return [header, '─'.repeat(header.length), ...lines].join('\n') + footer;
}
