import { randomUUID } from 'node:crypto';
import { config, logger, type Event } from '@genia/core';
import { pool, query } from '@genia/core/db';
import { buildOffersForEvent } from './index.js';

interface EventRow {
  id: string;
  dedupe_key: string;
  title: string;
  category: string;
  city: string;
  country: string;
  venue: string;
  capacity: number | null;
  starts_at: string;
  ends_at: string | null;
  source: string;
  source_url: string;
  score: string;
  status: string;
  created_at: string;
}

function mapEventRow(row: EventRow): Event {
  return {
    id: row.id,
    dedupeKey: row.dedupe_key,
    title: row.title,
    category: row.category as Event['category'],
    city: row.city,
    country: row.country,
    venue: row.venue,
    capacity: row.capacity,
    startsAt: new Date(row.starts_at),
    endsAt: row.ends_at ? new Date(row.ends_at) : null,
    source: row.source,
    sourceUrl: row.source_url,
    score: Number(row.score),
    status: row.status as Event['status'],
    createdAt: new Date(row.created_at),
  };
}

async function upsertTestEvent(): Promise<Event> {
  const startsAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const endsAt = new Date(startsAt.getTime() + 24 * 3600 * 1000);

  const result = await query<EventRow>(
    `INSERT INTO events (id, dedupe_key, title, category, city, country, venue, capacity, starts_at, ends_at, source, source_url, score, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (dedupe_key) DO UPDATE SET starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at
     RETURNING *`,
    [
      randomUUID(),
      'test_seed_event',
      'Test Concert — Seed Event',
      'concert',
      'New York',
      'USA',
      'Madison Square Garden',
      18000,
      startsAt,
      endsAt,
      'seed',
      'https://example.com/seed-event',
      50,
      'approved',
    ]
  );

  return mapEventRow(result.rows[0]);
}

async function main(): Promise<void> {
  const event = await upsertTestEvent();
  const offers = await buildOffersForEvent(event);

  for (const offer of offers) {
    logger.info('seeded test offer', {
      origin: offer.origin,
      offerId: offer.id,
      shortHash: offer.shortHash,
      subid: offer.subid,
      openInBrowser: `${config.redirectBaseUrl}/${offer.shortHash}`,
    });
  }

  await pool.end();
}

main().catch((err) => {
  logger.error('seed failed', { error: String(err) });
  process.exit(1);
});
