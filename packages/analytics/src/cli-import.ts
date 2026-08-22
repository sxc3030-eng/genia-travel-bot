import { readFile } from 'node:fs/promises';
import { logger } from '@genia/core';
import { pool } from '@genia/core/db';
import { importConversionsFromCsv, type Network } from './import.js';

async function main(): Promise<void> {
  const path = process.argv[2] ?? process.env.CONVERSIONS_CSV_PATH;
  if (!path) throw new Error('Usage: npm run analytics:import -- <chemin.csv> [partnerize|impact]');

  const network = (process.argv[3] as Network | undefined) ?? undefined;
  const summary = await importConversionsFromCsv({ csv: await readFile(path, 'utf8'), network });

  console.log('\nImport terminé :');
  console.log(`  lignes lues        : ${summary.parsed}`);
  console.log(`  insérées           : ${summary.imported}`);
  console.log(`  mises à jour       : ${summary.updated}`);
  console.log(`  hors plage         : ${summary.outOfRange}`);
  console.log(`  subid inconnu      : ${summary.unmatchedSubids}`);
  console.log(`  ignorées           : ${summary.skipped.length}`);
  for (const skipped of summary.skipped.slice(0, 10)) console.log(`    - ${skipped.reason}`);

  await pool.end();
}

main().catch((err) => {
  logger.error('import failed', { error: String(err) });
  process.exit(1);
});
