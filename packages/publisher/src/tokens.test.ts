import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALERT_THRESHOLD_DAYS, checkToken, evaluateToken } from './tokens.js';

const NOW = new Date('2026-08-22T00:00:00Z');
const inDays = (n: number) => Math.floor((NOW.getTime() + n * 24 * 3600 * 1000) / 1000);

test('a healthy long-dated token raises no alert', () => {
  const status = evaluateToken({ is_valid: true, expires_at: inDays(45), scopes: ['pages_manage_posts'] }, NOW);
  assert.equal(status.valid, true);
  assert.equal(status.needsAlert, false);
  assert.equal(status.daysRemaining, 45);
});

test('piège #1: the alert fires 7 days out, before the token dies', () => {
  const status = evaluateToken({ is_valid: true, expires_at: inDays(ALERT_THRESHOLD_DAYS) }, NOW);
  assert.equal(status.valid, true, 'still usable');
  assert.equal(status.needsAlert, true, 'but must warn while there is still time to refresh');
});

test('the day before the threshold does not alert yet', () => {
  const status = evaluateToken({ is_valid: true, expires_at: inDays(ALERT_THRESHOLD_DAYS + 1) }, NOW);
  assert.equal(status.needsAlert, false);
});

test('an expired token is invalid and alerts', () => {
  const status = evaluateToken({ is_valid: true, expires_at: inDays(-1) }, NOW);
  assert.equal(status.valid, false);
  assert.equal(status.needsAlert, true);
});

test('a token Meta reports invalid alerts regardless of dates', () => {
  const status = evaluateToken({ is_valid: false, error: { message: 'Session expired' } }, NOW);
  assert.equal(status.valid, false);
  assert.equal(status.needsAlert, true);
  assert.match(status.reason!, /Session expired/);
});

test('a non-expiring page token is healthy, not treated as already expired', () => {
  // Meta reports expires_at 0 for these; reading that as an epoch date would
  // make a perfectly good token look 56 years overdue.
  for (const expires_at of [0, undefined]) {
    const status = evaluateToken({ is_valid: true, expires_at }, NOW);
    assert.equal(status.valid, true);
    assert.equal(status.needsAlert, false);
    assert.equal(status.expiresAt, undefined);
  }
});

test('checkToken calls debug_token with the app-secret credential', async () => {
  let calledUrl = '';
  const fetchImpl = (async (url: string | URL) => {
    calledUrl = String(url);
    return { ok: true, status: 200, json: async () => ({ data: { is_valid: true, expires_at: inDays(30) } }) };
  }) as unknown as typeof fetch;

  const status = await checkToken({
    appId: 'APP',
    appSecret: 'SECRET',
    pageToken: 'PAGETOKEN',
    fetchImpl,
    now: NOW,
  });

  assert.equal(status.valid, true);
  assert.equal(status.daysRemaining, 30);
  assert.match(calledUrl, /debug_token\?/);
  assert.match(calledUrl, /input_token=PAGETOKEN/);
  assert.match(calledUrl, /access_token=APP%7CSECRET/);
});
