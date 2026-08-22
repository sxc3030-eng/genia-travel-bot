import type { Event } from '@genia/core';

export interface GateOptions {
  humanApprovalRequired: boolean;
  publishWindow: { minDays: number; maxDays: number };
  now?: Date;
}

export type GateRefusal =
  | 'not_approved'
  | 'already_published'
  | 'rejected'
  | 'event_passed'
  | 'too_soon'
  | 'too_far_out';

export interface GateDecision {
  publishable: boolean;
  refusal?: GateRefusal;
  daysUntil: number;
}

export function daysUntil(startsAt: Date, now: Date): number {
  return Math.floor((startsAt.getTime() - now.getTime()) / (24 * 3600 * 1000));
}

/**
 * The last check before anything is queued for a real audience.
 *
 * Decision #3 (manual approval for the first three weeks) is enforced here:
 * with `humanApprovalRequired`, only events a human moved to `approved` may be
 * queued. Decision #4 (the J-21..J-56 window) is enforced here too — outside
 * that window the travel booking window is closed and the post does not
 * convert, so queueing it is waste, not upside.
 */
export function evaluateGate(
  event: Pick<Event, 'status' | 'startsAt'>,
  options: GateOptions
): GateDecision {
  const now = options.now ?? new Date();
  const days = daysUntil(event.startsAt, now);

  if (event.status === 'rejected') return { publishable: false, refusal: 'rejected', daysUntil: days };
  if (event.status === 'published') return { publishable: false, refusal: 'already_published', daysUntil: days };
  if (options.humanApprovalRequired && event.status !== 'approved') {
    return { publishable: false, refusal: 'not_approved', daysUntil: days };
  }

  if (days < 0) return { publishable: false, refusal: 'event_passed', daysUntil: days };
  if (days < options.publishWindow.minDays) return { publishable: false, refusal: 'too_soon', daysUntil: days };
  if (days > options.publishWindow.maxDays) return { publishable: false, refusal: 'too_far_out', daysUntil: days };

  return { publishable: true, daysUntil: days };
}
