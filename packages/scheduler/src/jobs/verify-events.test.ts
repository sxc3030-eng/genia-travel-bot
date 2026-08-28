import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapSourceStatus } from '@genia/scanner';
import { JOBS, runJobSafely } from '../index.js';

test('source status codes map to the lifecycle we act on', () => {
  assert.equal(mapSourceStatus('onsale'), 'live');
  assert.equal(mapSourceStatus('offsale'), 'live');
  assert.equal(mapSourceStatus('cancelled'), 'cancelled');
  assert.equal(mapSourceStatus('canceled'), 'cancelled');
  assert.equal(mapSourceStatus('postponed'), 'postponed');
  assert.equal(mapSourceStatus('rescheduled'), 'rescheduled');
});

test('an unrecognised status is "unknown", never assumed cancelled', () => {
  // Pulling live ads on a status we do not understand would destroy working
  // campaigns; the safe default is to leave them alone.
  assert.equal(mapSourceStatus('something_new'), 'unknown');
  assert.equal(mapSourceStatus(undefined), 'unknown');
  assert.equal(mapSourceStatus(''), 'unknown');
});

test('a failing job never propagates out of the scheduler, and is reported', async () => {
  // Seven unattended days means one bad night must not stop the next six —
  // but the failure still has to be recorded, not swallowed.
  const failures: string[] = [];

  await runJobSafely(
    { name: 'exploding-job', cron: '0 0 * * *', run: async () => { throw new Error('boom'); } },
    async (job, error) => { failures.push(`${job.name}: ${String(error)}`); }
  );

  assert.equal(failures.length, 1);
  assert.match(failures[0], /exploding-job: Error: boom/);
});

test('a failure to report the failure still does not crash the scheduler', async () => {
  // The database may be the very thing that is down.
  await runJobSafely(
    { name: 'doubly-broken', cron: '0 0 * * *', run: async () => { throw new Error('boom'); } },
    async () => { throw new Error('alerting is down too'); }
  );
});

test('a successful job reports no failure', async () => {
  const failures: unknown[] = [];
  await runJobSafely(
    { name: 'fine', cron: '0 0 * * *', run: async () => 'ok' },
    async (_job, error) => { failures.push(error); }
  );
  assert.equal(failures.length, 0);
});

test('every scheduled job has a valid five-field cron expression', () => {
  for (const job of JOBS) {
    const fields = job.cron.trim().split(/\s+/);
    assert.equal(fields.length, 5, `${job.name}: "${job.cron}"`);
  }
});

test('job names are unique, so run-once can address them', () => {
  const names = JOBS.map((j) => j.name);
  assert.equal(new Set(names).size, names.length);
});

test('the scan runs before planning, so a day plans on fresh events', () => {
  const hourOf = (name: string) => Number(JOBS.find((j) => j.name === name)!.cron.split(' ')[1]);
  assert.ok(hourOf('scan') < hourOf('plan-posts'));
  // And cancelled events are pulled before any new ad is queued (piège #6).
  assert.ok(hourOf('verify-events') < hourOf('plan-posts'));
  assert.ok(hourOf('check-token') < hourOf('plan-posts'));
});
