import { logger } from '@genia/core';
import { pool } from '@genia/core/db';
import { buildReport, formatReport } from './report.js';
import { computeCategoryMultipliers } from './loop.js';

async function main(): Promise<void> {
  const groupBy = (process.argv[2] as 'category' | 'origin' | 'city') ?? 'category';
  const rows = await buildReport({ groupBy });

  console.log(`\n=== Rapport par ${groupBy} ===\n`);
  console.log(formatReport(rows, groupBy));

  if (groupBy === 'category') {
    console.log('\n=== Boucle de rétroaction (non branchée sur le scoring) ===\n');
    for (const m of computeCategoryMultipliers(rows)) {
      const status = m.confident ? `x${m.multiplier}` : 'échantillon insuffisant → x1';
      console.log(`  ${m.category.padEnd(12)} ${String(m.clicks).padStart(6)} clics   ${status}`);
    }
  }

  await pool.end();
}

main().catch((err) => {
  logger.error('report failed', { error: String(err) });
  process.exit(1);
});
