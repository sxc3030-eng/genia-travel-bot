import { config, logger } from '@genia/core';
import { pool, query } from '@genia/core/db';
import { runScan } from './index.js';
import { TicketmasterSource } from './sources/ticketmaster.js';

async function main(): Promise<void> {
  if (config.eventSourcePrimary !== 'ticketmaster') {
    throw new Error(`Unsupported EVENT_SOURCE_PRIMARY: ${config.eventSourcePrimary}`);
  }

  const source = new TicketmasterSource({
    apiKey: config.ticketmasterApiKey,
    geoScope: config.geoScope,
  });

  await runScan(source);

  const top = await query<{ score: string; title: string; city: string; category: string; starts_at: Date }>(
    `SELECT score, title, city, category, starts_at FROM events WHERE status = 'new' ORDER BY score DESC LIMIT 20`
  );

  logger.info('top scored events', { count: top.rowCount });
  for (const row of top.rows) {
    const date = row.starts_at.toISOString().slice(0, 10);
    console.log(
      `${String(row.score).padStart(6)}  ${row.category.padEnd(9)}  ${row.city.padEnd(18)}  ${date}  ${row.title}`
    );
  }

  await pool.end();
}

main().catch((err) => {
  logger.error('scan failed', { error: String(err) });
  process.exit(1);
});
