import { createHash } from 'node:crypto';
import express from 'express';
import { config, logger } from '@genia/core';
import { assertDbConnection, query } from '@genia/core/db';

interface OfferRow {
  id: string;
  target_url: string;
}

const app = express();
app.set('trust proxy', true);

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
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
