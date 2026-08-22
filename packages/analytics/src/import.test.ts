import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapRow, normaliseStatus, parseAmount } from './import.js';

test('parseAmount handles the formats affiliate exports actually use', () => {
  assert.equal(parseAmount('1234.56'), 1234.56);
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(parseAmount('$1,234.56'), 1234.56);
  // French-Canadian formatting: comma as the decimal separator.
  assert.equal(parseAmount('1234,56'), 1234.56);
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('-45.00'), -45);
});

test('parseAmount rejects rather than guessing at unparseable values', () => {
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('n/a'), null);
});

test('statuses are normalised across each network vocabulary', () => {
  assert.equal(normaliseStatus('Approved'), 'approved');
  assert.equal(normaliseStatus('confirmed'), 'approved');
  assert.equal(normaliseStatus('PAID'), 'paid');
  assert.equal(normaliseStatus('declined'), 'rejected');
  assert.equal(normaliseStatus('cancelled'), 'rejected');
  assert.equal(normaliseStatus('pending'), 'pending');
});

test('an unrecognised status is refused, not silently treated as approved', () => {
  // Guessing here would book revenue that the network never validated.
  assert.equal(normaliseStatus('weird-new-state'), null);
});

test('maps a Partnerize row', () => {
  const { record } = mapRow(
    {
      conversion_id: 'CV1',
      publisher_reference: 'evt123-yul-facebook-20260822',
      sale_value: '450.00',
      publisher_commission: '18.00',
      currency: 'cad',
      conversion_status: 'approved',
      conversion_time: '2026-08-22T10:00:00Z',
    },
    'partnerize'
  );

  assert.ok(record);
  assert.equal(record.externalId, 'CV1');
  assert.equal(record.subid, 'evt123-yul-facebook-20260822');
  assert.equal(record.bookingValue, 450);
  assert.equal(record.commission, 18);
  assert.equal(record.currency, 'CAD');
  assert.equal(record.status, 'approved');
});

test('maps an Impact row', () => {
  const { record } = mapRow(
    {
      action_id: 'A9',
      subid1: 'evt999-yyz-instagram-20260822',
      sale_amount: '1,200.00',
      payout: '48.00',
      currency: 'USD',
      status: 'PENDING',
      event_date: '2026-08-20',
    },
    'impact'
  );

  assert.ok(record);
  assert.equal(record.externalId, 'A9');
  assert.equal(record.bookingValue, 1200);
  assert.equal(record.status, 'pending');
});

test('a row without a subid is skipped, not attributed to nothing', () => {
  // These are other publishers' conversions or direct bookings; counting them
  // would credit our pipeline with revenue it did not produce.
  const { record, skipped } = mapRow(
    { conversion_id: 'CV2', sale_value: '10', publisher_commission: '1', conversion_status: 'approved', conversion_time: '2026-08-22' },
    'partnerize'
  );
  assert.equal(record, undefined);
  assert.match(skipped!.reason, /subid/);
});

test('a row without an external id is skipped, since it cannot be deduplicated', () => {
  const { skipped } = mapRow(
    { publisher_reference: 'x', sale_value: '10', publisher_commission: '1', conversion_status: 'approved', conversion_time: '2026-08-22' },
    'partnerize'
  );
  assert.match(skipped!.reason, /external id/);
});

test('an unparseable date is skipped rather than becoming Invalid Date', () => {
  const { skipped } = mapRow(
    { conversion_id: 'C', publisher_reference: 'x', sale_value: '1', publisher_commission: '1', conversion_status: 'approved', conversion_time: 'not a date' },
    'partnerize'
  );
  assert.match(skipped!.reason, /date/);
});

test('currency defaults to CAD only when the column is absent', () => {
  const { record } = mapRow(
    { conversion_id: 'C', publisher_reference: 'x', sale_value: '1', publisher_commission: '1', conversion_status: 'approved', conversion_time: '2026-08-22' },
    'partnerize'
  );
  assert.equal(record?.currency, 'CAD');
});
