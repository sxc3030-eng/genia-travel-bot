import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RawEvent } from '@genia/core';
import { buildDedupeKey, dedupeBatch, isNearDuplicate, slugify } from './dedupe.js';

function raw(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    title: 'Taylor Swift | The Eras Tour',
    category: 'concert',
    city: 'Montréal',
    country: 'CA',
    venue: 'Centre Bell',
    startsAt: new Date('2026-09-10T23:00:00Z'),
    sourceUrl: 'https://example.com/a',
    ...overrides,
  };
}

test('slugify strips accents and collapses punctuation', () => {
  assert.equal(slugify('Montréal'), 'montreal');
  assert.equal(slugify('Taylor Swift | The Eras Tour'), 'taylor-swift-the-eras-tour');
  assert.equal(slugify('  --Québec City--  '), 'quebec-city');
});

test('dedupe key is stable across accent and punctuation differences', () => {
  const a = buildDedupeKey(raw({ city: 'Montréal', title: 'Taylor Swift | The Eras Tour' }));
  const b = buildDedupeKey(raw({ city: 'Montreal', title: 'Taylor Swift - The Eras Tour' }));
  assert.equal(a, b);
});

test('dedupe key separates different dates and cities', () => {
  const base = buildDedupeKey(raw());
  assert.notEqual(base, buildDedupeKey(raw({ startsAt: new Date('2026-09-11T23:00:00Z') })));
  assert.notEqual(base, buildDedupeKey(raw({ city: 'Toronto' })));
});

test('isNearDuplicate matches a source-appended suffix regardless of base title length', () => {
  // Regression: the earlier truncate-to-4-words key silently failed here,
  // because the base title is only two words long.
  assert.ok(isNearDuplicate('osheaga-festival', 'osheaga-festival-presented-by-sponsor'));
  assert.ok(isNearDuplicate('taylor-swift-the-eras-tour', 'taylor-swift-the-eras-tour-presented-by-x'));
  assert.ok(isNearDuplicate('same-title', 'same-title'));
});

test('isNearDuplicate does not merge genuinely different events', () => {
  assert.equal(isNearDuplicate('osheaga-festival', 'osheaga-winter-festival'), false);
  assert.equal(isNearDuplicate('habs-at-rangers', 'habs-at-bruins'), false);
  // A single generic word must not swallow everything that starts with it.
  assert.equal(isNearDuplicate('festival', 'festival-of-lights'), false);
});

test('dedupeBatch collapses a suffix variant with a two-word base title', () => {
  const short = raw({ title: 'Osheaga Festival', sourceUrl: 'https://a.example' });
  const suffixed = raw({ title: 'Osheaga Festival - presented by Sponsor', capacity: 45000, sourceUrl: 'https://b.example' });

  const result = dedupeBatch([short, suffixed]);

  assert.equal(result.length, 1);
  assert.equal(result[0].capacity, 45000, 'keeps the record carrying a capacity');
});

test('dedupeBatch collapses cross-source duplicates and prefers the record with capacity', () => {
  const withoutCapacity = raw({ sourceUrl: 'https://a.example' });
  const withCapacity = raw({ city: 'Montreal', capacity: 21000, sourceUrl: 'https://b.example' });

  const result = dedupeBatch([withoutCapacity, withCapacity]);

  assert.equal(result.length, 1);
  assert.equal(result[0].capacity, 21000);
});

test('dedupeBatch keeps genuinely distinct events', () => {
  const result = dedupeBatch([raw(), raw({ city: 'Toronto', venue: 'Rogers Centre' })]);
  assert.equal(result.length, 2);
});

test('dedupeBatch keeps two different shows in the same city on the same night', () => {
  const result = dedupeBatch([
    raw({ title: 'Taylor Swift | The Eras Tour' }),
    raw({ title: 'Arcade Fire Live', venue: 'MTelus' }),
  ]);
  assert.equal(result.length, 2);
});
