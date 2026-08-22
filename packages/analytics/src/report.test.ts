import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReport, type ReportRow } from './report.js';

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

test('a dimension appears once, whatever its currencies', () => {
  // Regression: revenue used to be grouped by currency in the same query as
  // the counts, so a dimension with both converting and non-converting offers
  // split into two rows — and because the clicks were divided between them
  // while the conversions were not, the conversion rate was wrong on both.
  const rendered = formatReport([
    row({
      dimension: 'festival',
      clicks: 8,
      conversions: 2,
      conversionRate: 25,
      revenue: [
        { currency: 'CAD', bookingValue: 2000, revenue: 80 },
        { currency: 'USD', bookingValue: 500, revenue: 20 },
      ],
    }),
  ]);

  const dataLines = rendered.split('\n').filter((line) => line.startsWith('festival'));
  assert.equal(dataLines.length, 1);
  assert.match(dataLines[0], /25\.0 %/);
});

test('revenue in several currencies is shown side by side, never summed', () => {
  const rendered = formatReport([
    row({
      dimension: 'festival',
      clicks: 10,
      revenue: [
        { currency: 'CAD', bookingValue: 0, revenue: 80 },
        { currency: 'USD', bookingValue: 0, revenue: 20 },
      ],
    }),
  ]);

  assert.match(rendered, /80\.00 CAD \+ 20\.00 USD/);
  // 100.00 would be the wrong answer that looks right.
  assert.ok(!/\b100\.00\b/.test(rendered), rendered);
  assert.match(rendered, /plusieurs devises/);
});

test('rev/clic is left blank rather than invented across currencies', () => {
  const multi = formatReport([
    row({
      dimension: 'festival',
      clicks: 10,
      revenue: [
        { currency: 'CAD', bookingValue: 0, revenue: 80 },
        { currency: 'USD', bookingValue: 0, revenue: 20 },
      ],
      revenuePerClick: null,
    }),
  ]);
  const lastColumn = multi.split('\n')[2].trim().split(/\s+/).pop();
  assert.equal(lastColumn, '—');
});

test('a single-currency row does report rev/clic', () => {
  const rendered = formatReport([
    row({
      dimension: 'festival',
      clicks: 10,
      revenue: [{ currency: 'CAD', bookingValue: 0, revenue: 80 }],
      revenuePerClick: 8,
      revenuePerClickCurrency: 'CAD',
    }),
  ]);
  assert.match(rendered, /8\.000/);
});

test('a dimension with no conversions renders without inventing a currency', () => {
  const rendered = formatReport([row({ dimension: 'congres', clicks: 4, conversionRate: 0 })]);
  assert.match(rendered, /congres/);
  assert.ok(!/n\/a/.test(rendered), rendered);
});

test('an empty report says so instead of rendering a bare header', () => {
  assert.equal(formatReport([]), 'Aucune donnée.');
});
