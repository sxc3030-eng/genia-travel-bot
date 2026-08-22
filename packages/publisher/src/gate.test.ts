import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGate } from './gate.js';

const NOW = new Date('2026-01-01T00:00:00Z');
const WINDOW = { minDays: 21, maxDays: 56 };
const inDays = (n: number) => new Date(NOW.getTime() + n * 24 * 3600 * 1000);

const OPTIONS = { humanApprovalRequired: true, publishWindow: WINDOW, now: NOW };

test('an approved event inside the window is publishable', () => {
  const decision = evaluateGate({ status: 'approved', startsAt: inDays(35) }, OPTIONS);
  assert.equal(decision.publishable, true);
  assert.equal(decision.daysUntil, 35);
});

test('decision #3: a new event is blocked while manual approval is on', () => {
  const decision = evaluateGate({ status: 'new', startsAt: inDays(35) }, OPTIONS);
  assert.equal(decision.publishable, false);
  assert.equal(decision.refusal, 'not_approved');
});

test('turning approval off lets a new event through', () => {
  const decision = evaluateGate(
    { status: 'new', startsAt: inDays(35) },
    { ...OPTIONS, humanApprovalRequired: false }
  );
  assert.equal(decision.publishable, true);
});

test('a rejected event is never publishable, approval mode notwithstanding', () => {
  for (const humanApprovalRequired of [true, false]) {
    const decision = evaluateGate({ status: 'rejected', startsAt: inDays(35) }, { ...OPTIONS, humanApprovalRequired });
    assert.equal(decision.publishable, false);
    assert.equal(decision.refusal, 'rejected');
  }
});

test('an already published event is not queued again', () => {
  const decision = evaluateGate({ status: 'published', startsAt: inDays(35) }, OPTIONS);
  assert.equal(decision.refusal, 'already_published');
});

test('decision #4: the publish window is enforced at both edges', () => {
  assert.equal(evaluateGate({ status: 'approved', startsAt: inDays(21) }, OPTIONS).publishable, true);
  assert.equal(evaluateGate({ status: 'approved', startsAt: inDays(56) }, OPTIONS).publishable, true);
  assert.equal(evaluateGate({ status: 'approved', startsAt: inDays(20) }, OPTIONS).refusal, 'too_soon');
  assert.equal(evaluateGate({ status: 'approved', startsAt: inDays(57) }, OPTIONS).refusal, 'too_far_out');
});

test('a past event is refused rather than treated as merely too soon', () => {
  const decision = evaluateGate({ status: 'approved', startsAt: inDays(-1) }, OPTIONS);
  assert.equal(decision.refusal, 'event_passed');
});
