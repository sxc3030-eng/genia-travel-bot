import { Worker } from 'bullmq';
import { logger } from '@genia/core';
import { connection, queueNameFor, type QueuedPostJob } from '../queue.js';
import { buildClient, runPublishJob, type PublishDeps } from './publish.js';

/**
 * Facebook and Instagram get separate workers on separate queues, so a stalled
 * Instagram container poll cannot block Facebook posts and neither worker can
 * consume the other's jobs.
 */
export function createFacebookWorker(deps?: Partial<PublishDeps>): Worker<QueuedPostJob> {
  const publishDeps: PublishDeps = { client: deps?.client ?? buildClient(), ...deps };

  const worker = new Worker<QueuedPostJob>(
    queueNameFor('facebook'),
    async (job) => runPublishJob(job, 'facebook', publishDeps),
    { connection, concurrency: 1 }
  );

  worker.on('failed', (job, err) => {
    logger.warn('facebook job failed', { jobId: job?.id, error: err.message });
  });

  return worker;
}
