import { randomUUID } from 'node:crypto';

/**
 * End-to-end check of the phase 4 pipeline against a real Postgres and Redis,
 * with the Meta API stubbed. This is as close as the milestone gets without
 * live Meta credentials — it exercises the gate, the queue, both workers, the
 * daily throttle and the auth-failure path.
 *
 * Run with: npm run verify:pipeline
 */
import { logger, type Event } from '@genia/core';
import { pool, query } from '@genia/core/db';
import { buildOffersForEvent } from '@genia/linkbuilder';
import { planPostsForOffer } from './plan.js';
import { closeQueue, queueFor } from './queue.js';
import { createFacebookWorker } from './workers/facebook.js';
import { createInstagramWorker } from './workers/instagram.js';
import { MetaApiError } from './meta/errors.js';
import type { MetaClient } from './meta/client.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stubClient(behaviour: 'ok' | 'auth-error'): MetaClient {
  const publish = async () => {
    if (behaviour === 'auth-error') {
      throw new MetaApiError('Error validating access token', 190, undefined, 400, 'auth');
    }
    return { externalId: `EXT_${randomUUID().slice(0, 8)}` };
  };
  return { publishToFacebook: publish, publishToInstagram: publish } as unknown as MetaClient;
}

async function seedEvent(status: string, daysOut: number): Promise<Event> {
  const startsAt = new Date(Date.now() + daysOut * 24 * 3600 * 1000);
  const row = await query<any>(
    `INSERT INTO events (id, dedupe_key, title, category, city, country, venue, capacity, starts_at, ends_at, source, source_url, score, status)
     VALUES ($1,$2,$3,'concert','New York','US','MSG',18000,$4,$4,'e2e','https://x/e2e',80,$5) RETURNING *`,
    [randomUUID(), `e2e_${randomUUID()}`, 'E2E Test Show', startsAt, status]
  );
  const r = row.rows[0];
  return {
    id: r.id, dedupeKey: r.dedupe_key, title: r.title, category: r.category, city: r.city,
    country: r.country, venue: r.venue, capacity: r.capacity, startsAt: new Date(r.starts_at),
    endsAt: r.ends_at ? new Date(r.ends_at) : null, source: r.source, sourceUrl: r.source_url,
    score: Number(r.score), status: r.status, createdAt: new Date(r.created_at),
  };
}

async function reset() {
  await query(`DELETE FROM posts WHERE offer_id IN (SELECT o.id FROM offers o JOIN events e ON e.id=o.event_id WHERE e.source='e2e')`);
  await query(`DELETE FROM clicks WHERE offer_id IN (SELECT o.id FROM offers o JOIN events e ON e.id=o.event_id WHERE e.source='e2e')`);
  await query(`DELETE FROM offers WHERE event_id IN (SELECT id FROM events WHERE source='e2e')`);
  await query(`DELETE FROM events WHERE source='e2e'`);
  await queueFor('facebook').obliterate({ force: true });
  await queueFor('instagram').obliterate({ force: true });
}

async function counts(): Promise<Record<string, number>> {
  const r = await query<{ status: string; count: string }>(
    `SELECT p.status, count(*) FROM posts p JOIN offers o ON o.id=p.offer_id JOIN events e ON e.id=o.event_id
     WHERE e.source='e2e' GROUP BY p.status`
  );
  return Object.fromEntries(r.rows.map((x) => [x.status, Number(x.count)]));
}

async function main() {
  console.log('\n─── 1. GATE: un événement non approuvé ne doit jamais être mis en file ───');
  await reset();
  const notApproved = await seedEvent('new', 35);
  const [offerA] = await buildOffersForEvent(notApproved, { origins: ['YUL'] });
  const gated = await planPostsForOffer(notApproved, offerA);
  console.log('queued:', gated.queued, '| skipped:', gated.skipped.map((s) => s.reason).join(','));

  console.log('\n─── 2. GATE: hors fenêtre J-21..J-56 ───');
  const tooSoon = await seedEvent('approved', 5);
  const [offerB] = await buildOffersForEvent(tooSoon, { origins: ['YUL'] });
  const soon = await planPostsForOffer(tooSoon, offerB);
  console.log('queued:', soon.queued, '| skipped:', soon.skipped.map((s) => s.reason).join(','));

  console.log('\n─── 3. PUBLICATION: événement approuvé, dans la fenêtre ───');
  const ok = await seedEvent('approved', 35);
  const offers = await buildOffersForEvent(ok);
  let planned = 0;
  for (const o of offers) planned += (await planPostsForOffer(ok, o)).queued;
  console.log('posts mis en file:', planned, '(2 origines x 2 plateformes)');
  console.log('état avant workers:', await counts());

  const fb = createFacebookWorker({ client: stubClient('ok'), maxPostsPerDay: 10 });
  const ig = createInstagramWorker({ client: stubClient('ok'), maxPostsPerDay: 10 });
  await sleep(3000);
  console.log('état après workers:', await counts());

  const published = await query<{ platform: string; external_id: string; attempts: number }>(
    `SELECT p.platform, p.external_id, p.attempts FROM posts p JOIN offers o ON o.id=p.offer_id JOIN events e ON e.id=o.event_id
     WHERE e.source='e2e' AND p.status='published' ORDER BY p.platform`
  );
  for (const p of published.rows) console.log(`  ${p.platform.padEnd(10)} external_id=${p.external_id} attempts=${p.attempts}`);

  await fb.close(); await ig.close();

  console.log('\n─── 4. THROTTLE: plafond dur à 1/jour (piège #3) ───');
  await reset();
  const many = await seedEvent('approved', 35);
  const manyOffers = await buildOffersForEvent(many);
  for (const o of manyOffers) await planPostsForOffer(many, o, ['facebook']);
  console.log('posts mis en file:', (await counts()).queued ?? 0);

  const fb2 = createFacebookWorker({ client: stubClient('ok'), maxPostsPerDay: 1 });
  await sleep(3000);
  const after = await counts();
  const delayed = await queueFor('facebook').getDelayedCount();
  console.log('état:', after, '| jobs différés au lendemain:', delayed);
  await fb2.close();

  console.log('\n─── 5. TOKEN INVALIDE: échec permanent, pas de retry (piège #1) ───');
  await reset();
  const authEvt = await seedEvent('approved', 35);
  const [authOffer] = await buildOffersForEvent(authEvt, { origins: ['YUL'] });
  await planPostsForOffer(authEvt, authOffer, ['facebook']);

  const fb3 = createFacebookWorker({ client: stubClient('auth-error'), maxPostsPerDay: 10 });
  await sleep(3000);
  const authRow = await query<{ status: string; attempts: number; error: string }>(
    `SELECT p.status, p.attempts, p.error FROM posts p JOIN offers o ON o.id=p.offer_id JOIN events e ON e.id=o.event_id WHERE e.source='e2e'`
  );
  console.log('post:', authRow.rows[0]);
  console.log('jobs en attente de retry:', await queueFor('facebook').getDelayedCount(), '| échoués:', await queueFor('facebook').getFailedCount());
  await fb3.close();

  await reset();
  await closeQueue();
  await pool.end();
}

main().catch((e) => { logger.error('e2e failed', { error: String(e) }); process.exit(1); });
