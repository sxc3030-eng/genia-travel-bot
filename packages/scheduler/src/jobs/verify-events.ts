import { config, logger, raiseAlert } from '@genia/core';
import { query } from '@genia/core/db';
import { fetchEventState, type SourceEventStatus } from '@genia/scanner';
import { MetaClient } from '@genia/publisher';

/**
 * Piège #6: an event gets cancelled or moved, and a live ad keeps sending
 * people to book a trip for it.
 *
 * Re-checks events approaching their date, and unpublishes their posts when the
 * source says the event is no longer happening as listed.
 */

export const RECHECK_WITHIN_DAYS = 7;

export interface VerifyResult {
  checked: number;
  cancelled: number;
  rescheduled: number;
  unpublished: number;
  unpublishFailures: number;
  skippedNoSourceId: number;
}

interface EventRow {
  id: string;
  title: string;
  starts_at: Date;
  source: string;
  source_event_id: string | null;
}

export interface VerifyDeps {
  client?: MetaClient;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}

/** Statuses that mean the ad should come down. */
const DEAD_STATUSES: SourceEventStatus[] = ['cancelled', 'postponed'];

async function unpublishPostsFor(eventId: string, client: MetaClient, result: VerifyResult): Promise<void> {
  const posts = await query<{ id: string; external_id: string | null; platform: string }>(
    `SELECT p.id, p.external_id, p.platform
     FROM posts p JOIN offers o ON o.id = p.offer_id
     WHERE o.event_id = $1 AND p.status = 'published' AND p.external_id IS NOT NULL`,
    [eventId]
  );

  for (const post of posts.rows) {
    try {
      await client.deletePost(post.external_id!);
      await query(`UPDATE posts SET status = 'failed', error = 'unpublished: event cancelled' WHERE id = $1`, [
        post.id,
      ]);
      result.unpublished++;
    } catch (err) {
      // Do not abort the whole sweep for one post: the remaining cancelled
      // events still need their ads taken down.
      result.unpublishFailures++;
      logger.error('failed to unpublish post for cancelled event', {
        postId: post.id,
        platform: post.platform,
        error: String(err),
      });
    }
  }

  // Stop anything not yet published from going out at all.
  await query(
    `UPDATE posts SET status = 'failed', error = 'cancelled before publication'
     FROM offers o WHERE o.id = posts.offer_id AND o.event_id = $1 AND posts.status = 'queued'`,
    [eventId]
  );
}

export async function verifyUpcomingEvents(deps: VerifyDeps = {}): Promise<VerifyResult> {
  const result: VerifyResult = {
    checked: 0,
    cancelled: 0,
    rescheduled: 0,
    unpublished: 0,
    unpublishFailures: 0,
    skippedNoSourceId: 0,
  };

  const apiKey = deps.apiKey ?? config.ticketmasterApiKey;
  if (!apiKey) {
    logger.warn('skipping event re-verification: no source API key configured');
    return result;
  }

  const client =
    deps.client ??
    new MetaClient({
      pageId: config.meta.pageId,
      pageToken: config.meta.pageToken,
      igBusinessId: config.meta.igBusinessId,
    });

  const events = await query<EventRow>(
    `SELECT id, title, starts_at, source, source_event_id
     FROM events
     WHERE status IN ('approved', 'published')
       AND starts_at > now()
       AND starts_at <= now() + ($1 || ' days')::interval
     ORDER BY starts_at ASC`,
    [String(RECHECK_WITHIN_DAYS)]
  );

  for (const event of events.rows) {
    if (!event.source_event_id) {
      // Scanned before source ids were recorded; guessing its status from the
      // title would be worse than leaving it alone.
      result.skippedNoSourceId++;
      continue;
    }

    result.checked++;

    let state;
    try {
      state = await fetchEventState(event.source_event_id, { apiKey, fetchImpl: deps.fetchImpl });
    } catch (err) {
      logger.warn('event re-check failed', { eventId: event.id, error: String(err) });
      continue;
    }

    if (DEAD_STATUSES.includes(state.status)) {
      result.cancelled++;
      await unpublishPostsFor(event.id, client, result);
      await query(`UPDATE events SET status = 'rejected', verified_at = now() WHERE id = $1`, [event.id]);

      await raiseAlert({
        kind: 'EVENT_CANCELLED',
        severity: 'warning',
        message: `Événement ${state.status} : « ${event.title} » — annonces dépubliées`,
        context: { eventId: event.id, sourceStatus: state.status },
        dedupeWindowMinutes: 0,
      });
      continue;
    }

    if (state.status === 'rescheduled' && state.startsAt && state.startsAt.getTime() !== event.starts_at.getTime()) {
      // The offer's check-in dates were derived from the old date, so they are
      // now wrong. Take the ads down and let the next scan re-create the offer.
      result.rescheduled++;
      await unpublishPostsFor(event.id, client, result);
      await query(`UPDATE events SET starts_at = $2, status = 'new', verified_at = now() WHERE id = $1`, [
        event.id,
        state.startsAt,
      ]);

      await raiseAlert({
        kind: 'EVENT_CANCELLED',
        severity: 'warning',
        message: `Événement déplacé : « ${event.title} » — annonces dépubliées, offre à reconstruire`,
        context: { eventId: event.id, newStartsAt: state.startsAt.toISOString() },
        dedupeWindowMinutes: 0,
      });
      continue;
    }

    await query(`UPDATE events SET verified_at = now() WHERE id = $1`, [event.id]);
  }

  logger.info('event re-verification complete', { ...result });
  return result;
}
