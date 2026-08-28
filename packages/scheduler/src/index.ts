import { schedule, type ScheduledTask } from 'node-cron';
import { logger, raiseAlert } from '@genia/core';

export * from './spread.js';
export { dailyScan } from './jobs/scan.js';
export { planDailyPosts } from './jobs/plan.js';
export { checkMetaToken } from './jobs/tokens.js';
export { checkFailedPosts } from './jobs/failed-posts.js';
export { verifyUpcomingEvents, RECHECK_WITHIN_DAYS } from './jobs/verify-events.js';

import { dailyScan } from './jobs/scan.js';
import { planDailyPosts } from './jobs/plan.js';
import { checkMetaToken } from './jobs/tokens.js';
import { checkFailedPosts } from './jobs/failed-posts.js';
import { verifyUpcomingEvents } from './jobs/verify-events.js';

export interface JobDefinition {
  name: string;
  /** UTC — the scheduler runs with timezone 'UTC' so these are unambiguous. */
  cron: string;
  run: () => Promise<unknown>;
}

/**
 * Job order through the day matters:
 *   03:00 scan      — new events land before anything is planned
 *   04:00 verify    — cancelled events are pulled before ads go out (piège #6)
 *   05:00 tokens    — a dead token is known before the first publish
 *   06:00 plan      — queues the day's posts, spread across 10:00-20:00
 *   23:00 failures  — sweeps what went wrong today
 */
export const JOBS: JobDefinition[] = [
  { name: 'scan', cron: '0 3 * * *', run: dailyScan },
  { name: 'verify-events', cron: '0 4 * * *', run: verifyUpcomingEvents },
  { name: 'check-token', cron: '0 5 * * *', run: checkMetaToken },
  { name: 'plan-posts', cron: '0 6 * * *', run: () => planDailyPosts() },
  { name: 'check-failed-posts', cron: '0 23 * * *', run: () => checkFailedPosts() },
];

export type JobFailureHandler = (job: JobDefinition, error: unknown) => Promise<unknown>;

const defaultFailureHandler: JobFailureHandler = (job, error) =>
  raiseAlert({
    kind: 'WORKER_FAILED',
    severity: 'critical',
    message: `Tâche planifiée « ${job.name} » en échec : ${String(error)}`,
    context: { job: job.name },
  });

/**
 * Wraps a job so a throw never kills the scheduler process. Seven unattended
 * days means one bad night must not stop the following six.
 *
 * `onFailure` is injectable so tests can exercise the failure path without
 * writing rows into the real alerts table.
 */
export async function runJobSafely(
  job: JobDefinition,
  onFailure: JobFailureHandler = defaultFailureHandler
): Promise<void> {
  const startedAt = Date.now();
  try {
    await job.run();
    logger.info('scheduled job finished', { job: job.name, ms: Date.now() - startedAt });
  } catch (err) {
    logger.error('scheduled job failed', { job: job.name, error: String(err) });
    try {
      await onFailure(job, err);
    } catch (alertErr) {
      // The database may be the thing that is down; the log is the last resort.
      logger.error('could not record job failure alert', { job: job.name, error: String(alertErr) });
    }
  }
}

export function startScheduler(jobs: JobDefinition[] = JOBS): ScheduledTask[] {
  return jobs.map((job) => {
    logger.info('scheduling job', { job: job.name, cron: job.cron });
    return schedule(job.cron, () => void runJobSafely(job), { timezone: 'UTC' });
  });
}
