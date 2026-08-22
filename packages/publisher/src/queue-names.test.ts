import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queueNameFor } from './queue-names.js';

test('each platform gets its own queue', () => {
  // Regression: both workers previously shared one queue and filtered by job
  // name. BullMQ hands a worker every job on its queue, so the Facebook worker
  // would take an Instagram job, skip it, and BullMQ marked it completed — the
  // post never published and sat `queued` in the database forever.
  assert.notEqual(queueNameFor('facebook'), queueNameFor('instagram'));
});

test('queue names avoid the character BullMQ reserves', () => {
  // `:` is BullMQ's Redis key separator; a name containing it is rejected at
  // queue construction, which only surfaces at runtime.
  for (const platform of ['facebook', 'instagram'] as const) {
    assert.ok(!queueNameFor(platform).includes(':'), queueNameFor(platform));
  }
});

test('queue names are stable', () => {
  // Changing these strands jobs already queued in Redis under the old name.
  assert.equal(queueNameFor('facebook'), 'posts-facebook');
  assert.equal(queueNameFor('instagram'), 'posts-instagram');
});
