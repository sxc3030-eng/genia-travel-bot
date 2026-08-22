import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_CLICKS_FOR_SIGNAL, MULTIPLIER_RANGE, computeCategoryMultipliers } from './loop.js';
import type { ReportRow } from './report.js';

function row(overrides: Partial<ReportRow>): ReportRow {
  return {
    dimension: 'concert',
    events: 1,
    offers: 1,
    clicks: 0,
    conversions: 0,
    pendingConversions: 0,
    rejectedConversions: 0,
    revenue: [],
    conversionRate: null,
    revenuePerClick: null,
    revenuePerClickCurrency: null,
    ...overrides,
  };
}

test('a thin sample gets a neutral multiplier, not a confident verdict', () => {
  const result = computeCategoryMultipliers([
    row({ dimension: 'festival', clicks: MIN_CLICKS_FOR_SIGNAL - 1, revenue: [{ currency: 'CAD', bookingValue: 0, revenue: 500 }] }),
  ]);
  assert.equal(result[0].multiplier, 1);
  assert.equal(result[0].confident, false);
});

test('with no conversions at all, nothing is penalised', () => {
  // The state the system is in today. A naive multiplier would drive every
  // score to the floor and rank purely on noise.
  const result = computeCategoryMultipliers([
    row({ dimension: 'concert', clicks: 5000 }),
    row({ dimension: 'sport', clicks: 4000 }),
  ]);
  for (const entry of result) {
    assert.equal(entry.multiplier, 1);
    assert.equal(entry.confident, false);
  }
});

test('a category earning above average is boosted, below average is cut', () => {
  const result = computeCategoryMultipliers([
    row({ dimension: 'festival', clicks: 1000, revenue: [{ currency: 'CAD', bookingValue: 0, revenue: 300 }] }),
    row({ dimension: 'congres', clicks: 1000, revenue: [{ currency: 'CAD', bookingValue: 0, revenue: 20 }] }),
  ]);

  const festival = result.find((r) => r.category === 'festival')!;
  const congres = result.find((r) => r.category === 'congres')!;

  assert.ok(festival.confident && congres.confident);
  assert.ok(festival.multiplier > congres.multiplier, `${festival.multiplier} vs ${congres.multiplier}`);
});

test('multipliers stay inside the configured bounds', () => {
  const result = computeCategoryMultipliers([
    row({ dimension: 'festival', clicks: 1000, revenue: [{ currency: 'CAD', bookingValue: 0, revenue: 100000 }] }),
    row({ dimension: 'congres', clicks: 1000, revenue: [{ currency: 'CAD', bookingValue: 0, revenue: 0 }] }),
  ]);
  for (const entry of result) {
    assert.ok(entry.multiplier >= MULTIPLIER_RANGE.min, `${entry.category}: ${entry.multiplier}`);
    assert.ok(entry.multiplier <= MULTIPLIER_RANGE.max, `${entry.category}: ${entry.multiplier}`);
  }
});

test('rows of the same category across currencies are combined once', () => {
  const result = computeCategoryMultipliers([
    row({ dimension: 'sport', clicks: 600, revenue: [{ currency: 'CAD', bookingValue: 0, revenue: 60 }] }),
    row({ dimension: 'sport', clicks: 600, revenue: [{ currency: 'USD', bookingValue: 0, revenue: 60 }] }),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].clicks, 1200);
});
