import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TicketmasterSource, mapCategory, mapTicketmasterEvent } from './ticketmaster.js';

// Fixture shaped after the Discovery API's documented `_embedded.events[]`
// payload. It is a fixture, not a recording of a live call — the live request
// path is exercised only once a real TICKETMASTER_API_KEY is configured.
const tmEvent = {
  name: 'Montreal Canadiens at New York Rangers',
  url: 'https://www.ticketmaster.com/event/abc123',
  dates: { start: { dateTime: '2026-03-14T23:00:00Z' } },
  classifications: [{ segment: { name: 'Sports' }, genre: { name: 'Hockey' } }],
  _embedded: {
    venues: [{ name: 'Madison Square Garden', city: { name: 'New York' }, country: { countryCode: 'US' } }],
  },
};

test('maps a Discovery API event to RawEvent', () => {
  const mapped = mapTicketmasterEvent(tmEvent);
  assert.ok(mapped);
  assert.equal(mapped.title, 'Montreal Canadiens at New York Rangers');
  assert.equal(mapped.category, 'sport');
  assert.equal(mapped.city, 'New York');
  assert.equal(mapped.country, 'US');
  assert.equal(mapped.venue, 'Madison Square Garden');
  assert.equal(mapped.startsAt.toISOString(), '2026-03-14T23:00:00.000Z');
  assert.equal(mapped.sourceUrl, 'https://www.ticketmaster.com/event/abc123');
});

test('capacity is left undefined rather than guessed', () => {
  assert.equal(mapTicketmasterEvent(tmEvent)?.capacity, undefined);
});

test('falls back to localDate when dateTime is absent', () => {
  const mapped = mapTicketmasterEvent({ ...tmEvent, dates: { start: { localDate: '2026-07-04' } } });
  assert.equal(mapped?.startsAt.toISOString(), '2026-07-04T00:00:00.000Z');
});

test('returns null when a non-inventable field is missing', () => {
  assert.equal(mapTicketmasterEvent({ ...tmEvent, dates: undefined }), null);
  assert.equal(mapTicketmasterEvent({ ...tmEvent, _embedded: { venues: [] } }), null);
  assert.equal(mapTicketmasterEvent({ ...tmEvent, name: undefined }), null);
});

test('category mapping covers the four plan categories', () => {
  assert.equal(mapCategory({ classifications: [{ segment: { name: 'Music' } }] }), 'concert');
  assert.equal(mapCategory({ classifications: [{ segment: { name: 'Sports' } }] }), 'sport');
  assert.equal(mapCategory({ classifications: [{ segment: { name: 'Arts & Theatre' } }] }), 'festival');
  assert.equal(mapCategory({ name: 'Osheaga Festival 2026', classifications: [{ segment: { name: 'Music' } }] }), 'festival');
  assert.equal(mapCategory({ classifications: [{ segment: { name: 'Miscellaneous' } }] }), 'congres');
});

test('constructor refuses to run without an API key', () => {
  assert.throws(
    () => new TicketmasterSource({ apiKey: '', geoScope: 'north_america' }),
    /TICKETMASTER_API_KEY is required/
  );
});

test('fetch queries CA/US/MX under north_america scope and skips unmappable events', async () => {
  const requested: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    const href = String(url);
    requested.push(new URL(href).searchParams.get('countryCode') ?? '');
    return {
      ok: true,
      json: async () => ({ _embedded: { events: [tmEvent, { name: 'broken' }] }, page: { totalPages: 1 } }),
    };
  }) as unknown as typeof fetch;

  const source = new TicketmasterSource({ apiKey: 'k', geoScope: 'north_america', fetchImpl });
  const events = await source.fetch();

  assert.deepEqual(requested, ['CA', 'US', 'MX']);
  assert.equal(events.length, 3, 'one good event per country, the broken one dropped');
});

test('fetch surfaces a non-OK API response as an error', async () => {
  const fetchImpl = (async () => ({ ok: false, status: 401, text: async () => 'Invalid apikey' })) as unknown as typeof fetch;
  const source = new TicketmasterSource({ apiKey: 'bad', geoScope: 'world', fetchImpl });
  await assert.rejects(() => source.fetch(), /Ticketmaster API 401/);
});
