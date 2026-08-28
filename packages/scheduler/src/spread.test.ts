import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WINDOW, JITTER_MINUTES, spreadPostTimes } from './spread.js';

const noJitter = () => 0.5;
const morning = new Date('2026-08-22T08:00:00Z');

test('no posts means no slots', () => {
  assert.deepEqual(spreadPostTimes({ count: 0, from: morning }), []);
});

test('posts are spread through the window, not bunched at one instant', () => {
  const times = spreadPostTimes({ count: 4, from: morning, random: noJitter });

  const distinct = new Set(times.map((t) => t.getTime()));
  assert.equal(distinct.size, 4, 'every post needs its own slot');

  const gaps = times.slice(1).map((t, i) => t.getTime() - times[i].getTime());
  for (const gap of gaps) {
    assert.ok(gap >= 60 * 60 * 1000, `slots ${gap / 60000} min apart is a burst, not a spread`);
  }
});

test('every slot lands inside the posting window', () => {
  const times = spreadPostTimes({ count: 6, from: morning, random: noJitter });
  for (const time of times) {
    const hour = time.getUTCHours();
    assert.ok(hour >= DEFAULT_WINDOW.startHour, `${time.toISOString()} is before the window`);
    assert.ok(hour < DEFAULT_WINDOW.endHour, `${time.toISOString()} is after the window`);
  }
});

test('slots are never scheduled in the past', () => {
  // Mid-window: the remaining slots must all be ahead of now, or they publish
  // immediately and defeat the spreading entirely.
  const midday = new Date('2026-08-22T15:30:00Z');
  const times = spreadPostTimes({ count: 4, from: midday, random: noJitter });
  for (const time of times) {
    assert.ok(time.getTime() >= midday.getTime(), `${time.toISOString()} is before ${midday.toISOString()}`);
  }
});

test('after the window closes, slots roll to the next day', () => {
  const evening = new Date('2026-08-22T22:00:00Z');
  const times = spreadPostTimes({ count: 3, from: evening, random: noJitter });

  for (const time of times) {
    assert.equal(time.getUTCDate(), 23, `${time.toISOString()} should be tomorrow`);
    assert.ok(time.getUTCHours() >= DEFAULT_WINDOW.startHour);
  }
});

test('jitter stays within its stated bound', () => {
  const early = spreadPostTimes({ count: 1, from: morning, random: () => 0 });
  const late = spreadPostTimes({ count: 1, from: morning, random: () => 0.999 });
  const spreadMs = late[0].getTime() - early[0].getTime();
  assert.ok(spreadMs <= 2 * JITTER_MINUTES * 60_000 + 1000, `jitter spanned ${spreadMs / 60000} min`);
});

test('results come back in chronological order', () => {
  const times = spreadPostTimes({ count: 8, from: morning });
  const sorted = [...times].sort((a, b) => a.getTime() - b.getTime());
  assert.deepEqual(times, sorted);
});

test('a single post lands inside the window, not on its edge', () => {
  const times = spreadPostTimes({ count: 1, from: morning, random: noJitter });
  assert.equal(times[0].getUTCHours(), 15, 'midpoint of a 10:00-20:00 window');
});
