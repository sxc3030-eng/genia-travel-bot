import { randomUUID } from 'node:crypto';
import { logger } from '@genia/core';
import { pool, query } from '@genia/core/db';
import { importConversionsFromCsv } from './import.js';
import { buildReport, formatReport } from './report.js';
import { computeCategoryMultipliers } from './loop.js';

/**
 * End-to-end check of the phase 5 report against a real database.
 *
 * Seeds events, offers, clicks and an affiliate CSV, then verifies the numbers
 * the report produces. Run with: npm run analytics:verify
 */

interface Seed {
  category: string;
  city: string;
  origin: string;
  clicks: number;
}

const SEEDS: Seed[] = [
  { category: 'festival', city: 'New York', origin: 'YUL', clicks: 3 },
  { category: 'sport', city: 'Boston', origin: 'YYZ', clicks: 2 },
  { category: 'concert', city: 'Chicago', origin: 'YUL', clicks: 4 },
  { category: 'congres', city: 'Austin', origin: 'YYZ', clicks: 1 },
];

async function reset() {
  await query(`DELETE FROM conversions WHERE subid LIKE 'evtverify%'`);
  await query(`DELETE FROM clicks WHERE offer_id IN (SELECT o.id FROM offers o JOIN events e ON e.id=o.event_id WHERE e.source='verify')`);
  await query(`DELETE FROM posts WHERE offer_id IN (SELECT o.id FROM offers o JOIN events e ON e.id=o.event_id WHERE e.source='verify')`);
  await query(`DELETE FROM offers WHERE event_id IN (SELECT id FROM events WHERE source='verify')`);
  await query(`DELETE FROM events WHERE source='verify'`);
}

async function seed(): Promise<Array<{ subid: string; seed: Seed }>> {
  const out: Array<{ subid: string; seed: Seed }> = [];

  for (const s of SEEDS) {
    const eventId = randomUUID();
    await query(
      `INSERT INTO events (id, dedupe_key, title, category, city, country, venue, capacity, starts_at, ends_at, source, source_url, score, status)
       VALUES ($1,$2,$3,$4,$5,'US','V',10000, now() + interval '35 days', now() + interval '35 days','verify','https://x',70,'approved')`,
      [eventId, `verify_${randomUUID()}`, `${s.category} show`, s.category, s.city]
    );

    const subid = `evtverify-${s.origin.toLowerCase()}-${randomUUID().slice(0, 8)}`;
    const offer = await query<{ id: string }>(
      `INSERT INTO offers (event_id, origin, destination, check_in, check_out, product_type, target_url, short_hash, subid)
       VALUES ($1,$2,$3, current_date, current_date + 2, 'hotel', 'https://expedia', $4, $5) RETURNING id`,
      [eventId, s.origin, s.city, randomUUID().slice(0, 8), subid]
    );

    for (let i = 0; i < s.clicks; i++) {
      await query(`INSERT INTO clicks (offer_id, ip_hash, user_agent) VALUES ($1,$2,'verify')`, [
        offer.rows[0].id,
        randomUUID(),
      ]);
    }

    out.push({ subid, seed: s });
  }

  return out;
}

async function main() {
  await reset();
  const seeded = await seed();
  const bySubid = Object.fromEntries(seeded.map((s) => [s.seed.category, s.subid]));

  // Two approved conversions on the SAME offer, to prove clicks are not
  // multiplied by conversions in the join.
  const csv = [
    'conversion_id,publisher_reference,sale_value,publisher_commission,currency,conversion_status,conversion_time',
    `CV1,${bySubid.festival},"1,200.00",48.00,CAD,approved,2026-08-20T10:00:00Z`,
    `CV2,${bySubid.festival},800.00,32.00,CAD,paid,2026-08-21T10:00:00Z`,
    `CV3,${bySubid.concert},450.00,18.00,CAD,pending,2026-08-21T11:00:00Z`,
    `CV4,${bySubid.sport},999.00,40.00,CAD,rejected,2026-08-21T12:00:00Z`,
    `CV5,evtverify-unknown-subid,500.00,20.00,CAD,approved,2026-08-21T13:00:00Z`,
  ].join('\n');

  console.log('\n─── 1. IMPORT ───');
  const first = await importConversionsFromCsv({ csv });
  console.log('premier import :', {
    parsed: first.parsed,
    imported: first.imported,
    updated: first.updated,
    unmatchedSubids: first.unmatchedSubids,
  });

  console.log('\n─── 2. IDEMPOTENCE : réimport du même rapport ───');
  const second = await importConversionsFromCsv({ csv });
  console.log('deuxième import :', { imported: second.imported, updated: second.updated });
  const total = await query<{ count: string }>(`SELECT count(*) FROM conversions WHERE subid LIKE 'evtverify%'`);
  console.log('lignes en base :', total.rows[0].count, '(doit rester 5, pas 10)');

  console.log('\n─── 3. CHANGEMENT DE STATUT : pending → approved ───');
  const updatedCsv = csv.replace('CV3,' + bySubid.concert + ',450.00,18.00,CAD,pending', 'CV3,' + bySubid.concert + ',450.00,18.00,CAD,approved');
  const third = await importConversionsFromCsv({ csv: updatedCsv });
  console.log('troisième import :', { imported: third.imported, updated: third.updated });

  console.log('\n─── 4. RAPPORT PAR CATÉGORIE (jalon) ───\n');
  const rows = await buildReport();
  console.log(formatReport(rows.filter((r) => r.events > 0)));

  console.log('\n─── 5. RAPPORT PAR ORIGINE ───\n');
  console.log(formatReport((await buildReport({ groupBy: 'origin' })).filter((r) => r.events > 0), 'origine'));

  console.log('\n─── 6. BOUCLE DE RÉTROACTION ───');
  for (const m of computeCategoryMultipliers(rows)) {
    console.log(`  ${m.category.padEnd(10)} ${String(m.clicks).padStart(4)} clics  confiant=${m.confident}  x${m.multiplier}`);
  }

  await reset();
  await pool.end();
}

main().catch((e) => {
  logger.error('verify failed', { error: String(e) });
  process.exit(1);
});
