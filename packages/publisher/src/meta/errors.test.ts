import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MetaApiError, classifyMetaError, metaErrorFrom } from './errors.js';

test('rate-limit codes are retryable, not failures', () => {
  for (const code of [4, 17, 32, 613]) {
    assert.equal(classifyMetaError(code, 400), 'rate_limited', `code ${code}`);
  }
});

test('auth codes stop the retry loop', () => {
  // 190 is the one that actually bites: a token expires and every retry after
  // it is guaranteed to fail the same way.
  for (const code of [102, 190, 200, 210, 10]) {
    assert.equal(classifyMetaError(code, 400), 'auth', `code ${code}`);
  }
  assert.equal(new MetaApiError('x', 190, undefined, 400, 'auth').retryable, false);
});

test('transient server codes retry', () => {
  assert.equal(classifyMetaError(1, 500), 'transient');
  assert.equal(classifyMetaError(2, 500), 'transient');
  assert.equal(new MetaApiError('x', 1, undefined, 500, 'transient').retryable, true);
});

test('an unrecognised error code is permanent, not retried forever', () => {
  assert.equal(classifyMetaError(100, 400), 'permanent');
  assert.equal(new MetaApiError('x', 100, undefined, 400, 'permanent').retryable, false);
});

test('falls back to HTTP status when no error code is present', () => {
  assert.equal(classifyMetaError(undefined, 429), 'rate_limited');
  assert.equal(classifyMetaError(undefined, 401), 'auth');
  assert.equal(classifyMetaError(undefined, 403), 'auth');
  assert.equal(classifyMetaError(undefined, 503), 'transient');
  assert.equal(classifyMetaError(undefined, 400), 'permanent');
});

test('metaErrorFrom carries the message and code from the payload', () => {
  const err = metaErrorFrom(
    { error: { message: 'Error validating access token', code: 190, error_subcode: 463 } },
    400
  );
  assert.equal(err.kind, 'auth');
  assert.equal(err.code, 190);
  assert.equal(err.subcode, 463);
  assert.match(err.message, /validating access token/);
});
