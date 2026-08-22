import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAffiliateUrl, buildExpediaSearchUrl, buildOfferDates } from './expedia.js';

// Piège #4 (plan section 8): a malformed affiliate link gives away free traffic.
// This test is the automated guard — it must fail if the affiliate id or the
// subid ever stop showing up in the final URL, for either network.

test('buildAffiliateUrl embeds the affiliate id and subid (partnerize)', () => {
  const url = buildAffiliateUrl('https://www.expedia.ca/Hotel-Search?destination=NYC', 'evt123-direct-20260101', {
    affiliateId: 'AFF999',
    network: 'partnerize',
    pos: 'CA',
  });
  assert.ok(url.includes('AFF999'), 'affiliate id must appear in the final URL');
  assert.ok(url.includes(encodeURIComponent('evt123-direct-20260101')), 'subid must appear in the final URL');
});

test('buildAffiliateUrl embeds the affiliate id and subid (impact)', () => {
  const url = buildAffiliateUrl('https://www.expedia.ca/Hotel-Search?destination=NYC', 'evt123-direct-20260101', {
    affiliateId: 'AFF999',
    network: 'impact',
    pos: 'CA',
  });
  assert.ok(url.includes('AFF999'), 'affiliate id must appear in the final URL');
  assert.ok(url.includes(encodeURIComponent('evt123-direct-20260101')), 'subid must appear in the final URL');
});

test('buildOfferDates brackets the event with a day of buffer on each side', () => {
  const { checkIn, checkOut } = buildOfferDates(new Date('2026-09-10T00:00:00Z'), new Date('2026-09-12T00:00:00Z'));
  assert.equal(checkIn, '2026-09-09');
  assert.equal(checkOut, '2026-09-13');
});

test('buildOfferDates falls back to the start date when there is no end date', () => {
  const { checkIn, checkOut } = buildOfferDates(new Date('2026-09-10T00:00:00Z'), null);
  assert.equal(checkIn, '2026-09-09');
  assert.equal(checkOut, '2026-09-11');
});

test('buildExpediaSearchUrl targets the .ca domain for POS=CA', () => {
  const url = buildExpediaSearchUrl({
    destination: 'New York, USA',
    checkIn: '2026-09-09',
    checkOut: '2026-09-13',
    productType: 'hotel',
    pos: 'CA',
  });
  assert.ok(url.startsWith('https://www.expedia.ca/Hotel-Search?'));
});
