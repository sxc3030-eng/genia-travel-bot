import { logger, raiseAlert } from '@genia/core';
import { query } from '@genia/core/db';

/**
 * "Alertes sur worker en échec" from the plan.
 *
 * The worker already alerts on an auth failure, but a post that exhausted its
 * retries fails quietly. Over seven unattended days that is exactly the kind of
 * thing that goes unnoticed, so the backlog of failures is swept daily.
 */
export async function checkFailedPosts(sinceHours = 24): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT count(*) AS count FROM posts
     WHERE status = 'failed' AND error IS NOT NULL
       AND error NOT LIKE 'unpublished:%' AND error NOT LIKE 'cancelled before%'
       AND created_at > now() - ($1 || ' hours')::interval`,
    [String(sinceHours)]
  );

  const failed = Number(result.rows[0]?.count ?? 0);
  if (failed === 0) {
    logger.info('no failed posts in the window', { sinceHours });
    return 0;
  }

  await raiseAlert({
    kind: 'JOB_FAILED',
    severity: failed >= 3 ? 'critical' : 'warning',
    message: `${failed} publication(s) en échec sur les dernières ${sinceHours} h`,
    context: { failed, sinceHours },
  });

  return failed;
}
