import { logger } from '@genia/core';
import { assertDbConnection } from '@genia/core/db';
import { JOBS, startScheduler } from './index.js';

async function main(): Promise<void> {
  await assertDbConnection();
  const tasks = startScheduler();
  logger.info('scheduler started', { jobs: JOBS.map((j) => j.name) });

  const shutdown = async (signal: string) => {
    logger.info('stopping scheduler', { signal });
    await Promise.all(tasks.map((task) => task.stop()));
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('scheduler failed to start', { error: String(err) });
  process.exit(1);
});
