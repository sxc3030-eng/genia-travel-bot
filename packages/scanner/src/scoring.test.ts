import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RawEvent } from '@genia/core';
import { capacityScore, destinationScore, leadTimeScore, originCitiesFor, scoreEvent } from './scoring.js';

const WINDOW = { minDays: 21, maxDays: 56 };
const NOW = new Date('2026-01-01T00:00:00Z');
const ORIGINS = originCitiesFor(['YUL', 'YYZ']);

function raw(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    title: 'Some Big Show',
    category: 'concert',
    city: 'New York',
    country: 'US',
    venue: 'Madison Square Garden',
    startsAt: new Date('2026-02-05T00:00:00Z'), // 35 days out — inside the window
    sourceUrl: 'https://example.com/a',
    ...overrides,
  };
}

test('originCitiesFor maps configured airports to city names', () => {
  assert.deepEqual(ORIGINS, ['Montreal', 'Toronto']);
});

test('an event in an origin city scores zero on destination', () => {
  assert.equal(destinationScore('Montréal', ORIGINS), 0);
  assert.equal(destinationScore('Toronto', ORIGINS), 0);
  assert.equal(destinationScore('New York', ORIGINS), 20);
});

test('origin-city events rank below identical away events', () => {
  const away = scoreEvent(raw({ city: 'New York' }), { originCities: ORIGINS, publishWindow: WINDOW, now: NOW });
  const home = scoreEvent(raw({ city: 'Montreal' }), { originCities: ORIGINS, publishWindow: WINDOW, now: NOW });
  assert.ok(away > home, `expected away (${away}) to outrank home (${home})`);
  assert.equal(away - home, 20);
});

test('lead time peaks inside the publish window', () => {
  assert.equal(leadTimeScore(35, WINDOW), 25);
  assert.equal(leadTimeScore(21, WINDOW), 25);
  assert.equal(leadTimeScore(56, WINDOW), 25);
  assert.ok(leadTimeScore(3, WINDOW) < 25, 'too soon must score below the window');
  assert.ok(leadTimeScore(200, WINDOW) < 25, 'too far out must score below the window');
  assert.equal(leadTimeScore(-5, WINDOW), 0, 'past events score zero');
});

test('capacity is log-scaled with a neutral default when unknown', () => {
  assert.equal(capacityScore(undefined), 12);
  assert.equal(capacityScore(0), 12);
  assert.ok(capacityScore(60000) > capacityScore(5000));
  assert.ok(capacityScore(5000) > capacityScore(800));
  assert.ok(capacityScore(500000) <= 25, 'score is capped at 25');
});

test('scoreEvent stays within 0..100', () => {
  const best = scoreEvent(raw({ category: 'festival', capacity: 80000 }), {
    originCities: ORIGINS,
    publishWindow: WINDOW,
    now: NOW,
  });
  const worst = scoreEvent(raw({ category: 'congres', city: 'Montreal', startsAt: new Date('2025-01-01T00:00:00Z') }), {
    originCities: ORIGINS,
    publishWindow: WINDOW,
    now: NOW,
  });

  assert.ok(best <= 100 && best > 90, `best=${best}`);
  assert.ok(worst >= 0 && worst < 40, `worst=${worst}`);
});
