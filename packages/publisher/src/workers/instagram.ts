import { Worker } from 'bullmq';
import { logger } from '@genia/core';
import { connection, queueNameFor, type QueuedPostJob } from '../queue.js';
import { buildClient, runPublishJob, type PublishDeps } from './publish.js';

export function createInstagramWorker(deps?: Partial<PublishDeps>): Worker<QueuedPostJob> {
  const publishDeps: PublishDeps = { client: deps?.client ?? buildClient(), ...deps };

  const worker = new Worker<QueuedPostJob>(
    queueNameFor('instagram'),
    async (job) => runPublishJob(job, 'instagram', publishDeps),
    // Instagram publishing polls a media container, so a job holds for a while;
    // concurrency stays at 1 to keep posting paced per page.
    { connection, concurrency: 1 }
  );

  worker.on('failed', (job, err) => {
    logger.warn('instagram job failed', { jobId: job?.id, error: err.message });
  });

  return worker;
}
