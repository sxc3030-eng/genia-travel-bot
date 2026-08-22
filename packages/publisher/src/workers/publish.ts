import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { config, logger, type Platform } from '@genia/core';
import { query } from '@genia/core/db';
import { MetaApiError } from '../meta/errors.js';
import { MetaClient } from '../meta/client.js';
import { checkThrottle } from '../throttle.js';
import type { QueuedPostJob } from '../queue.js';

export interface PublishDeps {
  client: MetaClient;
  now?: () => Date;
  maxPostsPerDay?: number;
}

async function markPublished(postId: string, externalId: string): Promise<void> {
  await query(
    `UPDATE posts SET status = 'published', external_id = $2, published_at = now(), error = NULL WHERE id = $1`,
    [postId, externalId]
  );
}

async function markFailed(postId: string, message: string): Promise<void> {
  await query(`UPDATE posts SET status = 'failed', error = $2 WHERE id = $1`, [postId, message]);
}

async function bumpAttempts(postId: string): Promise<void> {
  await query(`UPDATE posts SET attempts = attempts + 1 WHERE id = $1`, [postId]);
}

/**
 * Shared publish path for both platforms.
 *
 * Order matters: the throttle is checked *inside* the worker, before any call
 * to Meta, so a backlog draining after downtime cannot burst past the daily
 * cap. When the cap is hit the job is delayed to the next UTC day rather than
 * failed — it is not an error that we published enough today.
 */
export async function runPublishJob(
  job: Job<QueuedPostJob>,
  platform: Platform,
  deps: PublishDeps
): Promise<{ externalId: string }> {
  const now = deps.now?.() ?? new Date();
  const limit = deps.maxPostsPerDay ?? config.maxPostsPerDay;

  const throttle = await checkThrottle(platform, limit, now);
  if (!throttle.allowed) {
    logger.info('throttled, deferring to next day', {
      platform,
      postId: job.data.postId,
      publishedToday: throttle.publishedToday,
      limit,
      retryAt: throttle.retryAt,
    });
    // moveToDelayed + DelayedError is BullMQ's way to postpone without
    // consuming a retry attempt.
    await job.moveToDelayed(throttle.retryAt!.getTime(), job.token);
    throw new DelayedError();
  }

  await bumpAttempts(job.data.postId);

  try {
    const result =
      platform === 'facebook'
        ? await deps.client.publishToFacebook({ imageUrl: job.data.imageUrl, caption: job.data.copy })
        : await deps.client.publishToInstagram({ imageUrl: job.data.imageUrl, caption: job.data.copy });

    await markPublished(job.data.postId, result.externalId);
    logger.info('published', { platform, postId: job.data.postId, externalId: result.externalId });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (err instanceof MetaApiError && !err.retryable) {
      // Auth and permanent failures will fail identically on every retry, so
      // the row is closed out now instead of burning four more attempts.
      await markFailed(job.data.postId, message);
      logger.error('publish failed permanently', {
        platform,
        postId: job.data.postId,
        kind: err.kind,
        code: err.code,
        message,
        ...(err.kind === 'auth' ? { alert: 'META_TOKEN_INVALID' } : {}),
      });
      // UnrecoverableError is how BullMQ is told to stop retrying now, rather
      // than working through the remaining attempts on a call that cannot pass.
      throw new UnrecoverableError(message);
    }

    await query(`UPDATE posts SET error = $2 WHERE id = $1`, [job.data.postId, message]);
    logger.warn('publish failed, will retry', {
      platform,
      postId: job.data.postId,
      attempt: job.attemptsMade + 1,
      message,
    });

    // A rate limit deserves a longer wait than the standard backoff curve.
    if (err instanceof MetaApiError && err.kind === 'rate_limited') {
      await job.moveToDelayed(Date.now() + 15 * 60_000, job.token);
      throw new DelayedError();
    }

    throw err;
  }
}

export function buildClient(): MetaClient {
  return new MetaClient({
    pageId: config.meta.pageId,
    pageToken: config.meta.pageToken,
    igBusinessId: config.meta.igBusinessId,
  });
}
