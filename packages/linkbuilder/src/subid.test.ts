import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSubid } from './subid.js';

const AT = new Date('2026-08-22T12:00:00Z');
const EVENT_ID = '0842a4c5-619a-4f75-abdd-aaaa07e04bfb';

test('subid carries event, origin, platform and date', () => {
  const subid = buildSubid({ eventId: EVENT_ID, origin: 'YUL', platform: 'direct', at: AT });
  assert.equal(subid, `evt${EVENT_ID}-yul-direct-20260822`);
});

test('the two origins we sell from never share a subid', () => {
  // Regression: before the origin was part of the subid, one event built for
  // YUL and YYZ on the same day produced identical subids, and `conversions`
  // (which joins on offers.subid) could not tell the two origins apart.
  const montreal = buildSubid({ eventId: EVENT_ID, origin: 'YUL', platform: 'direct', at: AT });
  const toronto = buildSubid({ eventId: EVENT_ID, origin: 'YYZ', platform: 'direct', at: AT });
  assert.notEqual(montreal, toronto);
});

test('platform still separates subids for a single origin', () => {
  const facebook = buildSubid({ eventId: EVENT_ID, origin: 'YUL', platform: 'facebook', at: AT });
  const instagram = buildSubid({ eventId: EVENT_ID, origin: 'YUL', platform: 'instagram', at: AT });
  assert.notEqual(facebook, instagram);
});
