/**
 * "Publication étalée" from the plan's phase 6.
 *
 * The worker's throttle caps how many posts go out per day, but a cap alone
 * does not stop all four firing within the same minute — and a burst is what
 * gets a page flagged, whatever the daily total. So queued posts are given
 * scheduled times spread across a posting window.
 *
 * This is the soft, cosmetic half of the protection; the worker's hard cap is
 * the half that actually holds when a backlog drains.
 */

export interface PostingWindow {
  /** Hour of day, local to POSTING_TIMEZONE_OFFSET. */
  startHour: number;
  endHour: number;
}

export const DEFAULT_WINDOW: PostingWindow = { startHour: 10, endHour: 20 };

/**
 * Minutes of jitter applied around each slot, so posts do not land on exact
 * round times day after day — a perfectly regular cadence reads as automated.
 */
export const JITTER_MINUTES = 12;

export interface SpreadOptions {
  count: number;
  window?: PostingWindow;
  from?: Date;
  /** Injectable for deterministic tests. Returns a value in [0, 1). */
  random?: () => number;
}

/**
 * Returns `count` times spread evenly through today's posting window.
 *
 * If the window has already partly passed, only the remaining part is used;
 * if it has passed entirely, the slots roll to tomorrow rather than being
 * scheduled in the past (which would publish them all immediately).
 */
export function spreadPostTimes(options: SpreadOptions): Date[] {
  const { count } = options;
  if (count <= 0) return [];

  const window = options.window ?? DEFAULT_WINDOW;
  const random = options.random ?? Math.random;
  const now = options.from ?? new Date();

  const dayStart = new Date(now);
  dayStart.setUTCHours(window.startHour, 0, 0, 0);
  const dayEnd = new Date(now);
  dayEnd.setUTCHours(window.endHour, 0, 0, 0);

  // The window has closed for today: roll everything to tomorrow.
  if (now >= dayEnd) {
    dayStart.setUTCDate(dayStart.getUTCDate() + 1);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  }

  const start = Math.max(dayStart.getTime(), now.getTime());
  const end = dayEnd.getTime();
  const span = Math.max(0, end - start);

  // Divide by count (not count - 1) so no slot lands exactly on the closing
  // edge, and a single post lands inside the window rather than at its start.
  const step = span / count;

  return Array.from({ length: count }, (_, index) => {
    const base = start + step * (index + 0.5);
    const jitter = (random() - 0.5) * 2 * JITTER_MINUTES * 60_000;
    const at = Math.min(end, Math.max(start, base + jitter));
    return new Date(Math.round(at));
  }).sort((a, b) => a.getTime() - b.getTime());
}
