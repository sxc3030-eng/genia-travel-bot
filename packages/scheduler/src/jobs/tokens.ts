import { config, logger, raiseAlert, resolveAlerts } from '@genia/core';
import { ALERT_THRESHOLD_DAYS, checkToken } from '@genia/publisher';

/** Piège #1: warn while there is still time to refresh, not after it dies. */
export async function checkMetaToken(): Promise<void> {
  if (!config.meta.appId || !config.meta.appSecret || !config.meta.pageToken) {
    logger.warn('skipping token check: Meta credentials not configured');
    return;
  }

  const status = await checkToken({
    appId: config.meta.appId,
    appSecret: config.meta.appSecret,
    pageToken: config.meta.pageToken,
  });

  if (!status.valid) {
    await raiseAlert({
      kind: 'META_TOKEN_INVALID',
      severity: 'critical',
      message: `Token Meta invalide : ${status.reason ?? 'raison inconnue'}`,
    });
    return;
  }

  if (status.needsAlert) {
    await raiseAlert({
      kind: 'META_TOKEN_EXPIRING',
      severity: 'warning',
      message: `Token Meta expire dans ${status.daysRemaining} jour(s)`,
      context: { expiresAt: status.expiresAt?.toISOString(), thresholdDays: ALERT_THRESHOLD_DAYS },
    });
    return;
  }

  // Healthy again — clear prior warnings so the alert list reflects reality.
  await resolveAlerts('META_TOKEN_EXPIRING');
  await resolveAlerts('META_TOKEN_INVALID');
  logger.info('meta token healthy', { daysRemaining: status.daysRemaining ?? 'never expires' });
}
