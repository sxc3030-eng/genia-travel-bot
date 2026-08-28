import { config, logger, raiseAlert } from '@genia/core';
import { TicketmasterSource, runScan } from '@genia/scanner';

/** Daily source sweep. A failure here is silent starvation, so it alerts. */
export async function dailyScan(): Promise<void> {
  if (!config.ticketmasterApiKey) {
    logger.warn('skipping scan: TICKETMASTER_API_KEY not configured');
    return;
  }

  try {
    await runScan(new TicketmasterSource({ apiKey: config.ticketmasterApiKey, geoScope: config.geoScope }));
  } catch (err) {
    await raiseAlert({
      kind: 'SCAN_FAILED',
      severity: 'critical',
      message: `Le scan quotidien a échoué : ${String(err)}`,
      context: { source: config.eventSourcePrimary },
    });
    throw err;
  }
}
