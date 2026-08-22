import { metaErrorFrom, transportError, type MetaErrorBody } from './meta/errors.js';

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

/** Piège #1: alert this many days before a token dies, not after. */
export const ALERT_THRESHOLD_DAYS = 7;

export interface TokenStatus {
  valid: boolean;
  /** Undefined means "never expires" — long-lived Page tokens report 0. */
  expiresAt?: Date;
  daysRemaining?: number;
  needsAlert: boolean;
  scopes: string[];
  reason?: string;
}

interface DebugTokenResponse {
  data?: {
    is_valid?: boolean;
    expires_at?: number;
    scopes?: string[];
    error?: { message?: string };
  };
}

export function evaluateToken(
  data: NonNullable<DebugTokenResponse['data']>,
  now: Date,
  thresholdDays = ALERT_THRESHOLD_DAYS
): TokenStatus {
  const scopes = data.scopes ?? [];

  if (!data.is_valid) {
    return { valid: false, needsAlert: true, scopes, reason: data.error?.message ?? 'token reported invalid' };
  }

  // Meta reports 0 (or omits it) for tokens that do not expire — typically a
  // Page token derived from a long-lived user token. Those still get revoked
  // when a password changes, which is why the workers alert on auth errors too.
  if (!data.expires_at) return { valid: true, needsAlert: false, scopes };

  const expiresAt = new Date(data.expires_at * 1000);
  const daysRemaining = Math.floor((expiresAt.getTime() - now.getTime()) / (24 * 3600 * 1000));

  return {
    valid: daysRemaining > 0,
    expiresAt,
    daysRemaining,
    needsAlert: daysRemaining <= thresholdDays,
    scopes,
    ...(daysRemaining <= thresholdDays ? { reason: `token expires in ${daysRemaining} day(s)` } : {}),
  };
}

export interface TokenCheckOptions {
  appId: string;
  appSecret: string;
  pageToken: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}

export async function checkToken(options: TokenCheckOptions): Promise<TokenStatus> {
  const doFetch = options.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    input_token: options.pageToken,
    access_token: `${options.appId}|${options.appSecret}`,
  });

  let response: Response;
  try {
    response = await doFetch(`${GRAPH_BASE}/debug_token?${params.toString()}`);
  } catch (cause) {
    throw transportError(cause);
  }

  const payload = (await response.json().catch(() => ({}))) as DebugTokenResponse & MetaErrorBody;
  if (!response.ok || payload.error) throw metaErrorFrom(payload, response.status);
  if (!payload.data) return { valid: false, needsAlert: true, scopes: [], reason: 'debug_token returned no data' };

  return evaluateToken(payload.data, options.now ?? new Date());
}
