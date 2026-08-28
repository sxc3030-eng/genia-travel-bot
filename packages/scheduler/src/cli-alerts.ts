import { listOpenAlerts, logger } from '@genia/core';
import { pool } from '@genia/core/db';

async function main(): Promise<void> {
  const alerts = await listOpenAlerts();
  if (alerts.length === 0) {
    console.log('Aucune alerte ouverte.');
  } else {
    console.log(`\n${alerts.length} alerte(s) ouverte(s) :\n`);
    for (const a of alerts) {
      console.log(`  [${a.severity.toUpperCase().padEnd(8)}] ${a.kind.padEnd(22)} ${a.createdAt.toISOString().slice(0, 16)}  ${a.message}`);
    }
  }
  await pool.end();
}

main().catch((err) => { logger.error('alerts failed', { error: String(err) }); process.exit(1); });
