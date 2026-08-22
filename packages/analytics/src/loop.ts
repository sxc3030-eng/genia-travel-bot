import type { ReportRow } from './report.js';

/**
 * The "↺ réinjecte dans [1]" arrow: turns measured revenue-per-click into a
 * per-category multiplier the scanner's scoring can apply.
 *
 * Deliberately NOT wired into scoring yet. With no conversions recorded, every
 * category measures zero revenue-per-click, and a naive multiplier would drive
 * every score to the floor — the loop would confidently rank on noise. It needs
 * a real affiliate report first; `MIN_CLICKS_FOR_SIGNAL` is the guard that
 * decides when a category has earned an opinion.
 */

/** Below this many clicks a category's rate is noise, so its multiplier is 1. */
export const MIN_CLICKS_FOR_SIGNAL = 200;

/** Bounds so one lucky month cannot dominate scoring outright. */
export const MULTIPLIER_RANGE = { min: 0.7, max: 1.3 };

export interface CategoryMultiplier {
  category: string;
  multiplier: number;
  clicks: number;
  revenuePerClick: number | null;
  confident: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Scales each category's revenue-per-click against the overall average.
 * A category earning double the average gets the maximum multiplier; one
 * earning nothing gets the minimum — but only once it has enough clicks to say
 * so.
 */
export function computeCategoryMultipliers(rows: ReportRow[]): CategoryMultiplier[] {
  const byCategory = new Map<string, { clicks: number; revenue: number }>();

  for (const row of rows) {
    const entry = byCategory.get(row.dimension) ?? { clicks: 0, revenue: 0 };
    entry.clicks += row.clicks;
    // Summing revenue across currencies is wrong, but the ratio below is
    // relative and unitless; a mixed-currency estimate is still directionally
    // usable, and the confidence gate keeps a thin sample out of scoring.
    entry.revenue += row.revenue.reduce((sum, r) => sum + r.revenue, 0);
    byCategory.set(row.dimension, entry);
  }

  const totals = [...byCategory.values()].reduce(
    (acc, entry) => ({ clicks: acc.clicks + entry.clicks, revenue: acc.revenue + entry.revenue }),
    { clicks: 0, revenue: 0 }
  );

  const averageRpc = totals.clicks > 0 ? totals.revenue / totals.clicks : 0;

  return [...byCategory.entries()].map(([category, entry]) => {
    const revenuePerClick = entry.clicks > 0 ? entry.revenue / entry.clicks : null;
    const confident = entry.clicks >= MIN_CLICKS_FOR_SIGNAL && averageRpc > 0;

    if (!confident || revenuePerClick === null) {
      return { category, multiplier: 1, clicks: entry.clicks, revenuePerClick, confident: false };
    }

    const ratio = revenuePerClick / averageRpc;
    const multiplier = clamp(
      MULTIPLIER_RANGE.min + (ratio / 2) * (MULTIPLIER_RANGE.max - MULTIPLIER_RANGE.min),
      MULTIPLIER_RANGE.min,
      MULTIPLIER_RANGE.max
    );

    return { category, multiplier: Number(multiplier.toFixed(3)), clicks: entry.clicks, revenuePerClick, confident: true };
  });
}
