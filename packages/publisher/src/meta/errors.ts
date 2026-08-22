/**
 * Meta Graph API error handling.
 *
 * How an error is classified decides everything downstream: whether the job
 * retries, how long it waits, and whether a human has to be alerted. Retrying
 * a permanent failure burns the queue; failing a rate-limit permanently drops
 * a post that would have succeeded ten minutes later.
 */

export type FailureKind =
  /** Retry with the normal exponential backoff. */
  | 'transient'
  /** Retry, but back off much harder — Meta is actively throttling us. */
  | 'rate_limited'
  /** Stop retrying and alert: the token is dead, no amount of waiting fixes it. */
  | 'auth'
  /** Stop retrying: the request itself is wrong and will fail identically. */
  | 'permanent';

export interface MetaErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly code: number | undefined,
    readonly subcode: number | undefined,
    readonly httpStatus: number,
    readonly kind: FailureKind
  ) {
    super(message);
    this.name = 'MetaApiError';
  }

  get retryable(): boolean {
    return this.kind === 'transient' || this.kind === 'rate_limited';
  }
}

/** Application-level and page-level throttling codes. */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

/** Token invalid, expired, or permissions revoked — a human must re-auth. */
const AUTH_CODES = new Set([102, 190, 200, 210, 10]);

/** Transient server-side failures Meta explicitly tells us to retry. */
const TRANSIENT_CODES = new Set([1, 2]);

export function classifyMetaError(code: number | undefined, httpStatus: number): FailureKind {
  if (code !== undefined) {
    if (RATE_LIMIT_CODES.has(code)) return 'rate_limited';
    if (AUTH_CODES.has(code)) return 'auth';
    if (TRANSIENT_CODES.has(code)) return 'transient';
    // A known error code that is none of the above is a bad request: the same
    // call will fail the same way, so retrying only wastes attempts.
    return 'permanent';
  }

  if (httpStatus === 429) return 'rate_limited';
  if (httpStatus === 401 || httpStatus === 403) return 'auth';
  if (httpStatus >= 500) return 'transient';
  return 'permanent';
}

export function metaErrorFrom(body: MetaErrorBody, httpStatus: number): MetaApiError {
  const code = body.error?.code;
  const message = body.error?.message ?? `Meta API request failed with HTTP ${httpStatus}`;
  return new MetaApiError(message, code, body.error?.error_subcode, httpStatus, classifyMetaError(code, httpStatus));
}

/** Network-level failures (DNS, socket) are transient by nature. */
export function transportError(cause: unknown): MetaApiError {
  return new MetaApiError(`Meta API transport failure: ${String(cause)}`, undefined, undefined, 0, 'transient');
}
