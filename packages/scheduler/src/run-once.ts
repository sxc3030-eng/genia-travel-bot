import { logger } from '@genia/core';
import { pool } from '@genia/core/db';
import { JOBS, runJobSafely } from './index.js';

/** Runs one scheduled job by name, for manual triggering and verification. */
async function main(): Promise<void> {
  const name = process.argv[2];
  const job = JOBS.find((j) => j.name === name);

  if (!job) {
    throw new Error(`Usage: npm run schedule:job -- <${JOBS.map((j) => j.name).join('|')}>`);
  }

  await runJobSafely(job);
  await pool.end();
}

main().catch((err) => {
  logger.error('job run failed', { error: String(err) });
  process.exit(1);
});
