import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { config, type Platform, type PostJob } from '@genia/core';
import { query } from '@genia/core/db';
import { queueNameFor } from './queue-names.js';

export { queueNameFor } from './queue-names.js';


/** BullMQ requires this to be null, otherwise blocking commands throw on retry. */
export const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

const queues = new Map<Platform, Queue<QueuedPostJob>>();

export function queueFor(platform: Platform): Queue<QueuedPostJob> {
  let queue = queues.get(platform);
  if (!queue) {
    queue = new Queue<QueuedPostJob>(queueNameFor(platform), { connection });
    queues.set(platform, queue);
  }
  return queue;
}

/**
 * The job carries `postId` in addition to the plan's PostJob fields: the posts
 * row is created at enqueue time so the database — not Redis — is the record
 * of what was queued. If Redis is lost, the queued rows are still there.
 */
export interface QueuedPostJob extends PostJob {
  postId: string;
}

/**
 * Exponential backoff per the plan. The first retry waits a minute: Meta
 * failures are rarely worth hammering, and a tight retry loop against a page
 * is itself the burst behaviour we are trying to avoid.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
};

/** Contract from plan section 5: enqueuePost(job) -> job id. */
export async function enqueuePost(job: PostJob): Promise<string> {
  const inserted = await query<{ id: string }>(
    `INSERT INTO posts (offer_id, platform, status, scheduled_at)
     VALUES ($1, $2, 'queued', $3)
     RETURNING id`,
    [job.offerId, job.platform, job.scheduledAt]
  );

  const postId = inserted.rows[0].id;
  const delay = Math.max(0, job.scheduledAt.getTime() - Date.now());

  const queued = await queueFor(job.platform).add(
    job.platform,
    { ...job, postId },
    { ...DEFAULT_JOB_OPTIONS, delay, jobId: postId }
  );

  return queued.id ?? postId;
}

export async function closeQueue(): Promise<void> {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
  await connection.quit();
}
