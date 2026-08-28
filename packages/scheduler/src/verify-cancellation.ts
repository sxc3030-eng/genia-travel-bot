import { randomUUID } from 'node:crypto';
import { listOpenAlerts, logger } from '@genia/core';
import { pool, query } from '@genia/core/db';
import type { MetaClient } from '@genia/publisher';
import { verifyUpcomingEvents } from './jobs/verify-events.js';

/**
 * End-to-end check of piège #6 against a real database, with the source API
 * and Meta both stubbed. Run with: npm run schedule:verify
 */

const deleted: string[] = [];

const stubMeta = {
  deletePost: async (externalId: string) => {
    deleted.push(externalId);
    return { deleted: true };
  },
} as unknown as MetaClient;

function stubSource(statusByEventId: Record<string, string>) {
  return (async (url: string | URL) => {
    const id = decodeURIComponent(String(url).split('/events/')[1]?.split('.json')[0] ?? '');
    const code = statusByEventId[id];
    if (code === '404') return { ok: false, status: 404, json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ id, dates: { status: { code }, start: { dateTime: '2026-12-01T23:00:00Z' } } }),
    };
  }) as unknown as typeof fetch;
}

async function seedEvent(sourceEventId: string | null, daysOut: number) {
  const eventId = randomUUID();
  await query(
    `INSERT INTO events (id, dedupe_key, title, category, city, country, venue, capacity, starts_at, ends_at,
                         source, source_url, score, status, source_event_id)
     VALUES ($1,$2,$3,'concert','New York','US','MSG',18000, now() + ($4 || ' days')::interval,
             now() + ($4 || ' days')::interval, 'ticketmaster','https://x',80,'approved',$5)`,
    [eventId, `p6_${randomUUID()}`, `Show ${sourceEventId ?? 'legacy'}`, String(daysOut), sourceEventId]
  );

  const offer = await query<{ id: string }>(
    `INSERT INTO offers (event_id, origin, destination, check_in, check_out, product_type, target_url, short_hash, subid)
     VALUES ($1,'YUL','New York', current_date, current_date + 2, 'hotel','https://expedia',$2,$3) RETURNING id`,
    [eventId, randomUUID().slice(0, 8), `evtp6-${randomUUID().slice(0, 8)}`]
  );

  await query(
    `INSERT INTO posts (offer_id, platform, status, external_id, published_at)
     VALUES ($1,'facebook','published',$2, now())`,
    [offer.rows[0].id, `FBPOST_${sourceEventId ?? 'legacy'}`]
  );
  await query(`INSERT INTO posts (offer_id, platform, status) VALUES ($1,'instagram','queued')`, [offer.rows[0].id]);

  return eventId;
}

async function reset() {
  await query(`DELETE FROM posts WHERE offer_id IN (SELECT o.id FROM offers o JOIN events e ON e.id=o.event_id WHERE e.dedupe_key LIKE 'p6_%')`);
  await query(`DELETE FROM offers WHERE event_id IN (SELECT id FROM events WHERE dedupe_key LIKE 'p6_%')`);
  await query(`DELETE FROM events WHERE dedupe_key LIKE 'p6_%'`);
  await query(`DELETE FROM alerts WHERE kind = 'EVENT_CANCELLED'`);
}

async function statusOf(eventId: string) {
  const e = await query<{ status: string }>(`SELECT status FROM events WHERE id=$1`, [eventId]);
  const p = await query<{ status: string; error: string | null; platform: string }>(
    `SELECT p.platform, p.status, p.error FROM posts p JOIN offers o ON o.id=p.offer_id WHERE o.event_id=$1 ORDER BY p.platform`,
    [eventId]
  );
  return { event: e.rows[0]?.status, posts: p.rows };
}

async function main() {
  await reset();

  const cancelled = await seedEvent('TM_CANCELLED', 3);
  const live = await seedEvent('TM_LIVE', 3);
  const gone = await seedEvent('TM_GONE', 3);
  const legacy = await seedEvent(null, 3);
  const faraway = await seedEvent('TM_FARAWAY', 40);

  const result = await verifyUpcomingEvents({
    client: stubMeta,
    apiKey: 'test-key',
    fetchImpl: stubSource({ TM_CANCELLED: 'cancelled', TM_LIVE: 'onsale', TM_GONE: '404', TM_FARAWAY: 'onsale' }),
  });

  console.log('\n─── RÉSULTAT DU BALAYAGE J-7 ───');
  console.log(result);

  console.log('\n─── 1. ÉVÉNEMENT ANNULÉ ───');
  console.log(await statusOf(cancelled));

  console.log('\n─── 2. ÉVÉNEMENT TOUJOURS ACTIF (ne doit rien changer) ───');
  console.log(await statusOf(live));

  console.log('\n─── 3. ANNONCE DISPARUE DE LA SOURCE (404) ───');
  console.log(await statusOf(gone));

  console.log('\n─── 4. SANS ID SOURCE (ignoré, pas deviné) ───');
  console.log(await statusOf(legacy));

  console.log('\n─── 5. HORS FENÊTRE J-7 (non vérifié) ───');
  console.log(await statusOf(faraway));

  console.log('\n─── POSTS SUPPRIMÉS CHEZ META ───');
  console.log(deleted);

  console.log('\n─── ALERTES OUVERTES ───');
  for (const a of await listOpenAlerts()) console.log(`  [${a.severity}] ${a.kind}: ${a.message}`);

  await reset();
  await pool.end();
}

main().catch((e) => {
  logger.error('verify failed', { error: String(e) });
  process.exit(1);
});
