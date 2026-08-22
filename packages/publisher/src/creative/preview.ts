import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config, logger, type Platform } from '@genia/core';
import { query, pool } from '@genia/core/db';
import { renderCopy } from './copy.js';
import { renderImage } from './image.js';

/**
 * Generates the phase 3 milestone: a batch of creatives plus a contact sheet
 * to review them by eye. Reads real rows when the database has scored events,
 * and falls back to a fixture set so the milestone is reviewable before the
 * scanner has run against a live Ticketmaster key.
 */

const OUT_DIR = path.resolve(process.cwd(), 'creative-preview');

interface PreviewRow {
  title: string;
  city: string;
  category: string;
  starts_at: Date;
  origin: string;
  short_hash: string;
  check_in: string;
  check_out: string;
}

const FIXTURES: PreviewRow[] = [
  ['Osheaga Festival', 'New York', 'festival', '2026-09-26', 'YUL', 'a1b2c3d4', '2026-09-25', '2026-09-28'],
  ['Montreal Canadiens at New York Rangers', 'New York', 'sport', '2026-10-01', 'YYZ', 'e5f6g7h8', '2026-09-30', '2026-10-02'],
  ['Rock & Roll Hall of Fame "Live"', 'Cleveland', 'concert', '2026-10-12', 'YUL', 'i9j0k1l2', '2026-10-11', '2026-10-13'],
  ['Formula 1 Grand Prix', 'Austin', 'sport', '2026-10-18', 'YYZ', 'm3n4o5p6', '2026-10-17', '2026-10-19'],
  ["New Orleans Jazz & Heritage Festival", 'New Orleans', 'festival', '2026-11-02', 'YUL', 'q7r8s9t0', '2026-11-01', '2026-11-04'],
  ['Web Summit', 'Vancouver', 'congres', '2026-11-09', 'YYZ', 'u1v2w3x4', '2026-11-08', '2026-11-11'],
  ['Taylor Swift | The Eras Tour', 'Chicago', 'concert', '2026-11-15', 'YUL', 'y5z6a7b8', '2026-11-14', '2026-11-16'],
  ['Boston Marathon', 'Boston', 'sport', '2026-11-22', 'YYZ', 'c9d0e1f2', '2026-11-21', '2026-11-23'],
  ['Coachella Valley Music and Arts Festival Weekend One', 'Indio', 'festival', '2026-12-05', 'YUL', 'g3h4i5j6', '2026-12-04', '2026-12-07'],
  ['NBA Finals Game 3', 'Miami', 'sport', '2026-12-13', 'YYZ', 'k7l8m9n0', '2026-12-12', '2026-12-14'],
].map(([title, city, category, date, origin, short_hash, check_in, check_out]) => ({
  title,
  city,
  category,
  starts_at: new Date(`${date}T23:00:00Z`),
  origin,
  short_hash,
  check_in,
  check_out,
}));

async function loadRows(limit: number): Promise<{ rows: PreviewRow[]; source: 'database' | 'fixtures' }> {
  const result = await query<PreviewRow>(
    `SELECT e.title, e.city, e.category, e.starts_at, o.origin, o.short_hash, o.check_in, o.check_out
     FROM offers o JOIN events e ON e.id = o.event_id
     ORDER BY e.score DESC LIMIT $1`,
    [limit]
  );

  if (result.rows.length >= limit) return { rows: result.rows, source: 'database' };
  return { rows: FIXTURES.slice(0, limit), source: 'fixtures' };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function main(): Promise<void> {
  const count = Number(process.argv[2] ?? 10);
  await mkdir(OUT_DIR, { recursive: true });

  const { rows, source } = await loadRows(count);
  const cards: string[] = [];

  for (const [index, row] of rows.entries()) {
    const platform: Platform = index % 2 === 0 ? 'instagram' : 'facebook';
    const event = { title: row.title, city: row.city, category: row.category as never, startsAt: row.starts_at };
    const offer = {
      origin: row.origin,
      shortHash: row.short_hash,
      checkIn: String(row.check_in).slice(0, 10),
      checkOut: String(row.check_out).slice(0, 10),
    };

    const copy = renderCopy({ event, offer, platform, redirectBaseUrl: config.redirectBaseUrl });
    const png = await renderImage({ event, offer, platform });

    const file = `${String(index + 1).padStart(2, '0')}-${platform}-${row.origin}.png`;
    await writeFile(path.join(OUT_DIR, file), png);

    cards.push(`<article class="card">
      <img src="${file}" alt="${escapeHtml(row.title)}">
      <div class="meta">
        <span class="tag ${platform}">${platform}</span>
        <span class="tag">${row.origin} · ${copy.locale}</span>
        <span class="tag">${copy.linkIsInCaption ? 'lien dans le texte' : 'lien en bio'}</span>
      </div>
      <pre>${escapeHtml(copy.text)}</pre>
    </article>`);
  }

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Créas — revue manuelle</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; margin: 0; padding: 32px; background: #10151b; color: #e8eef5; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  p.sub { color: #9fb0c2; margin: 0 0 28px; font-size: 14px; }
  .grid { display: grid; gap: 24px; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); }
  .card { background: #182029; border: 1px solid #26313d; border-radius: 12px; overflow: hidden; }
  .card img { width: 100%; display: block; background: #0d1218; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 14px 0; }
  .tag { font-size: 11px; padding: 3px 8px; border-radius: 999px; background: #26313d; color: #c7d6e5; }
  .tag.instagram { background: #7b2d6b; color: #fff; }
  .tag.facebook { background: #1c3d80; color: #fff; }
  pre { margin: 12px 14px 16px; padding: 12px; background: #0d1218; border-radius: 8px;
        white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.5; color: #dbe6f0; }
</style></head>
<body>
  <h1>Créas — revue manuelle (jalon phase 3)</h1>
  <p class="sub">${rows.length} créas · données : <strong>${source === 'database' ? 'base de données' : 'fixtures'}</strong> · la mention « Publicité » est générée par le gabarit, jamais ajoutée à la main.</p>
  <div class="grid">${cards.join('\n')}</div>
</body></html>`;

  await writeFile(path.join(OUT_DIR, 'index.html'), html);
  logger.info('creative preview written', { dir: OUT_DIR, count: rows.length, source });

  await pool.end();
}

main().catch((err) => {
  logger.error('creative preview failed', { error: String(err) });
  process.exit(1);
});
