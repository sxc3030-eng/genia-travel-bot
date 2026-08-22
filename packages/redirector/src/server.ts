import { createHash } from 'node:crypto';
import express from 'express';
import { config, logger, type Platform } from '@genia/core';
import { assertDbConnection, query } from '@genia/core/db';
import { renderImage } from '@genia/publisher/creative/image';

interface OfferRow {
  id: string;
  target_url: string;
}

interface CreativeRow {
  title: string;
  city: string;
  starts_at: Date;
  origin: string;
}

const app = express();
app.set('trust proxy', true);

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

/**
 * Serves the generated creative for an offer.
 *
 * This exists because Instagram's publish API takes an `image_url` that Meta
 * fetches itself — local bytes cannot be uploaded — so the card has to live at
 * a public URL. The redirector is already the public surface, and the image is
 * regenerated deterministically from the offer's own row, so nothing extra has
 * to be stored.
 */
app.get('/img/:platform/:hash.png', async (req, res) => {
  const platform = req.params.platform as Platform;
  if (platform !== 'facebook' && platform !== 'instagram') {
    res.status(400).send('Unknown platform');
    return;
  }

  const result = await query<CreativeRow>(
    `SELECT e.title, e.city, e.starts_at, o.origin
     FROM offers o JOIN events e ON e.id = o.event_id
     WHERE o.short_hash = $1`,
    [req.params.hash]
  );

  const row = result.rows[0];
  if (!row) {
    res.status(404).send('Offer not found');
    return;
  }

  const png = await renderImage({
    event: { title: row.title, city: row.city, startsAt: row.starts_at },
    offer: { origin: row.origin },
    platform,
  });

  res.type('png').set('Cache-Control', 'public, max-age=86400').send(png);
});

app.get('/go/:hash', async (req, res) => {
  const { hash } = req.params;

  const result = await query<OfferRow>('SELECT id, target_url FROM offers WHERE short_hash = $1', [hash]);
  const offer = result.rows[0];

  if (!offer) {
    res.status(404).send('Offer not found');
    return;
  }

  const ip = req.ip ?? '';
  const ipHash = createHash('sha256').update(ip).digest('hex');

  await query(
    `INSERT INTO clicks (offer_id, ip_hash, user_agent, referer) VALUES ($1, $2, $3, $4)`,
    [offer.id, ipHash, req.get('user-agent') ?? null, req.get('referer') ?? null]
  );

  res.redirect(302, offer.target_url);
});

async function main(): Promise<void> {
  await assertDbConnection();
  logger.info('connected to database');

  app.listen(config.port, () => {
    logger.info('redirector listening', { port: config.port });
  });
}

main().catch((err) => {
  logger.error('redirector failed to start', { error: String(err) });
  process.exit(1);
});
