import { query } from './db.js';
import { logger } from './logger.js';

export type AlertSeverity = 'warning' | 'critical';

export type AlertKind =
  | 'META_TOKEN_INVALID'
  | 'META_TOKEN_EXPIRING'
  | 'WORKER_FAILED'
  | 'JOB_FAILED'
  | 'SCAN_FAILED'
  | 'EVENT_CANCELLED'
  | 'IMPORT_FAILED';

export interface RaiseAlertInput {
  kind: AlertKind;
  severity: AlertSeverity;
  message: string;
  context?: Record<string, unknown>;
  /**
   * Suppress a repeat of the same kind raised within this many minutes. The
   * scheduler runs the same checks every day and a failing worker retries
   * constantly; without this a single stuck token would write thousands of
   * rows and bury everything else.
   */
  dedupeWindowMinutes?: number;
}

const DEFAULT_DEDUPE_MINUTES = 12 * 60;

/**
 * Records an alert durably and logs it.
 *
 * Logging alone is not enough for the phase 6 milestone: seven days unattended
 * only works if a failure that happened on day two is still visible on day
 * seven. The row stays unresolved until something clears it.
 */
export async function raiseAlert(input: RaiseAlertInput): Promise<{ raised: boolean; id?: string }> {
  const windowMinutes = input.dedupeWindowMinutes ?? DEFAULT_DEDUPE_MINUTES;

  const existing = await query<{ id: string }>(
    `SELECT id FROM alerts
     WHERE kind = $1 AND resolved_at IS NULL AND created_at > now() - ($2 || ' minutes')::interval
     LIMIT 1`,
    [input.kind, String(windowMinutes)]
  );

  if (existing.rowCount) {
    logger.debug('alert suppressed as duplicate', { kind: input.kind, existing: existing.rows[0].id });
    return { raised: false, id: existing.rows[0].id };
  }

  const inserted = await query<{ id: string }>(
    `INSERT INTO alerts (kind, severity, message, context) VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.kind, input.severity, input.message, JSON.stringify(input.context ?? {})]
  );

  const log = input.severity === 'critical' ? logger.error : logger.warn;
  log(input.message, { alert: input.kind, severity: input.severity, ...input.context });

  await notifyWebhook(input);

  return { raised: true, id: inserted.rows[0].id };
}

/** Optional outbound notification. Never throws: an alert must be recorded even if the webhook is down. */
async function notifyWebhook(input: RaiseAlertInput): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: `[${input.severity.toUpperCase()}] ${input.kind}: ${input.message}`,
        context: input.context ?? {},
      }),
    });
  } catch (err) {
    logger.warn('alert webhook failed', { kind: input.kind, error: String(err) });
  }
}

export async function resolveAlerts(kind: AlertKind): Promise<number> {
  const result = await query(`UPDATE alerts SET resolved_at = now() WHERE kind = $1 AND resolved_at IS NULL`, [kind]);
  return result.rowCount ?? 0;
}

export interface OpenAlert {
  id: string;
  kind: string;
  severity: string;
  message: string;
  createdAt: Date;
}

export async function listOpenAlerts(): Promise<OpenAlert[]> {
  const result = await query<{ id: string; kind: string; severity: string; message: string; created_at: Date }>(
    `SELECT id, kind, severity, message, created_at FROM alerts WHERE resolved_at IS NULL ORDER BY created_at DESC`
  );
  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    message: row.message,
    createdAt: row.created_at,
  }));
}
