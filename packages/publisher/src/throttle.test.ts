import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideThrottle, nextUtcDay, startOfUtcDay } from './throttle.js';

const NOW = new Date('2026-08-22T18:30:00Z');

test('publishing is allowed while under the daily cap', () => {
  const decision = decideThrottle(3, 4, NOW);
  assert.equal(decision.allowed, true);
  assert.equal(decision.retryAt, undefined);
});

test('the cap is a hard stop, not a soft target', () => {
  // MAX_POSTS_PER_DAY=4 means the 5th publish of the day must not go out —
  // a burst is what gets a page flagged (piège #3).
  const decision = decideThrottle(4, 4, NOW);
  assert.equal(decision.allowed, false);
  assert.equal(decision.publishedToday, 4);
});

test('a blocked job is deferred to the next UTC day, not failed', () => {
  const decision = decideThrottle(4, 4, NOW);
  assert.deepEqual(decision.retryAt, new Date('2026-08-23T00:00:00Z'));
});

test('day boundaries are computed in UTC', () => {
  assert.deepEqual(startOfUtcDay(NOW), new Date('2026-08-22T00:00:00Z'));
  assert.deepEqual(nextUtcDay(NOW), new Date('2026-08-23T00:00:00Z'));
});

test('a cap of zero blocks everything', () => {
  assert.equal(decideThrottle(0, 0, NOW).allowed, false);
});
