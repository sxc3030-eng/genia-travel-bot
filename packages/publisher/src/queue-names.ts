import type { Platform } from '@genia/core';

/**
 * One queue per platform, not one shared queue with per-name filtering.
 *
 * BullMQ workers consume every job on their queue regardless of job name, so
 * two workers sharing a queue race for the same jobs: the Facebook worker
 * would pick up an Instagram job, skip it, and BullMQ would mark it completed —
 * silently dropping a post that stayed `queued` in the database forever. An
 * integration run caught exactly that. Separate queues make the routing
 * structural instead of conventional.
 *
 * Kept free of imports with side effects so it stays unit-testable without
 * opening a Redis connection.
 */
export function queueNameFor(platform: Platform): string {
  // Hyphen, not colon: BullMQ reserves `:` as its Redis key separator and
  // rejects it in queue names.
  return `posts-${platform}`;
}
