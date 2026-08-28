import { config, logger, type Event, type Offer } from '@genia/core';
import { query } from '@genia/core/db';
import { buildOffersForEvent } from '@genia/linkbuilder';
import { planPostsForOffer } from '@genia/publisher';
import { spreadPostTimes } from '../spread.js';

interface EventRow {
  id: string; dedupe_key: string; title: string; category: string; city: string; country: string;
  venue: string; capacity: number | null; starts_at: Date; ends_at: Date | null; source: string;
  source_url: string; score: string; status: string; created_at: Date;
}

function mapEvent(row: EventRow): Event {
  return {
    id: row.id, dedupeKey: row.dedupe_key, title: row.title, category: row.category as Event['category'],
    city: row.city, country: row.country, venue: row.venue, capacity: row.capacity,
    startsAt: row.starts_at, endsAt: row.ends_at, source: row.source, sourceUrl: row.source_url,
    score: Number(row.score), status: row.status as Event['status'], createdAt: row.created_at,
  };
}

export interface PlanSummary {
  events: number;
  offersBuilt: number;
  postsQueued: number;
}

/**
 * Turns approved events into scheduled posts, spread through the posting
 * window rather than queued all at the same instant.
 *
 * Only takes the top `MAX_POSTS_PER_DAY` events by score: queueing more than a
 * day's budget just builds a backlog the worker will defer anyway.
 */
export async function planDailyPosts(now = new Date()): Promise<PlanSummary> {
  const summary: PlanSummary = { events: 0, offersBuilt: 0, postsQueued: 0 };

  const events = await query<EventRow>(
    `SELECT e.* FROM events e
     WHERE e.status = 'approved'
       AND e.starts_at BETWEEN now() + ($1 || ' days')::interval AND now() + ($2 || ' days')::interval
       AND NOT EXISTS (
         SELECT 1 FROM offers o JOIN posts p ON p.offer_id = o.id
         WHERE o.event_id = e.id AND p.status IN ('queued', 'published')
       )
     ORDER BY e.score DESC
     LIMIT $3`,
    [String(config.publishWindow.minDays), String(config.publishWindow.maxDays), String(config.maxPostsPerDay)]
  );

  if (events.rowCount === 0) {
    logger.info('nothing to plan today');
    return summary;
  }

  // One scheduled time per post: two platforms per offer, one offer per origin.
  const perEvent = config.originAirports.length * 2;
  const times = spreadPostTimes({ count: events.rows.length * perEvent, from: now });
  let slot = 0;

  for (const row of events.rows) {
    const event = mapEvent(row);
    summary.events++;

    const existing = await query<{ id: string; event_id: string; origin: string; destination: string;
      check_in: string; check_out: string; product_type: string; target_url: string; short_hash: string; subid: string }>(
      'SELECT * FROM offers WHERE event_id = $1', [event.id]
    );

    const offers: Offer[] = existing.rowCount
      ? existing.rows.map((o) => ({
          id: o.id, eventId: o.event_id, origin: o.origin, destination: o.destination,
          checkIn: String(o.check_in).slice(0, 10), checkOut: String(o.check_out).slice(0, 10),
          productType: o.product_type as Offer['productType'], targetUrl: o.target_url,
          shortHash: o.short_hash, subid: o.subid,
        }))
      : await buildOffersForEvent(event);

    if (!existing.rowCount) summary.offersBuilt += offers.length;

    for (const offer of offers) {
      const result = await planPostsForOffer(event, offer, ['facebook', 'instagram'], times[slot] ?? now);
      summary.postsQueued += result.queued;
      slot += 2;
    }
  }

  logger.info('daily planning complete', { ...summary });
  return summary;
}
