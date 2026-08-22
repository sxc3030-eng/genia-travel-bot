import { config, logger } from '@genia/core';
import { ALERT_THRESHOLD_DAYS, checkToken } from './tokens.js';

/**
 * Run on a schedule (phase 6 cron). Exits non-zero when the token needs
 * attention, so a cron wrapper or monitor can alert on it.
 */
async function main(): Promise<void> {
  if (!config.meta.appId || !config.meta.appSecret || !config.meta.pageToken) {
    throw new Error('META_APP_ID, META_APP_SECRET and META_PAGE_TOKEN are required to check the token');
  }

  const status = await checkToken({
    appId: config.meta.appId,
    appSecret: config.meta.appSecret,
    pageToken: config.meta.pageToken,
  });

  if (!status.valid) {
    logger.error('meta token invalid', { alert: 'META_TOKEN_INVALID', reason: status.reason });
    process.exit(1);
  }

  if (status.needsAlert) {
    logger.warn('meta token expiring soon', {
      alert: 'META_TOKEN_EXPIRING',
      daysRemaining: status.daysRemaining,
      expiresAt: status.expiresAt,
      thresholdDays: ALERT_THRESHOLD_DAYS,
    });
    process.exit(1);
  }

  logger.info('meta token healthy', {
    daysRemaining: status.daysRemaining ?? 'never expires',
    scopes: status.scopes,
  });
}

main().catch((err) => {
  logger.error('token check failed', { error: String(err) });
  process.exit(1);
});
