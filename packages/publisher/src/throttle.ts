import type { Platform } from '@genia/core';
import { query } from '@genia/core/db';

/**
 * Piège #3: the throttle lives in the worker, not the cron.
 *
 * A cron that spaces jobs out still lets a backlog, a retry storm, or a manual
 * re-run fire everything at once — and a burst is what gets a page flagged. The
 * worker is the only place every publish must pass through, so the cap is
 * enforced here, against the database rather than in-process counters (which
 * reset on restart and do not survive multiple workers).
 */

export interface ThrottleDecision {
  allowed: boolean;
  publishedToday: number;
  limit: number;
  /** When blocked, the UTC instant at which the daily budget resets. */
  retryAt?: Date;
}

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function nextUtcDay(now: Date): Date {
  return new Date(startOfUtcDay(now).getTime() + 24 * 3600 * 1000);
}

export function decideThrottle(publishedToday: number, limit: number, now: Date): ThrottleDecision {
  if (publishedToday < limit) return { allowed: true, publishedToday, limit };
  return { allowed: false, publishedToday, limit, retryAt: nextUtcDay(now) };
}

/** Counts what this platform actually published today, from the posts table. */
export async function countPublishedToday(platform: Platform, now: Date): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT count(*) AS count FROM posts
     WHERE platform = $1 AND status = 'published' AND published_at >= $2 AND published_at < $3`,
    [platform, startOfUtcDay(now), nextUtcDay(now)]
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function checkThrottle(platform: Platform, limit: number, now = new Date()): Promise<ThrottleDecision> {
  return decideThrottle(await countPublishedToday(platform, now), limit, now);
}
