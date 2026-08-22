import { logger } from '@genia/core';
import { assertDbConnection } from '@genia/core/db';
import { createFacebookWorker } from './facebook.js';
import { createInstagramWorker } from './instagram.js';

async function main(): Promise<void> {
  await assertDbConnection();

  const workers = [createFacebookWorker(), createInstagramWorker()];
  logger.info('publisher workers started', { queues: workers.length });

  const shutdown = async (signal: string) => {
    logger.info('shutting down workers', { signal });
    await Promise.all(workers.map((worker) => worker.close()));
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('workers failed to start', { error: String(err) });
  process.exit(1);
});
