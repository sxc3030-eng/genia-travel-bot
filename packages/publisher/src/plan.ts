import { config, logger, type Event, type Offer, type Platform } from '@genia/core';
import { query } from '@genia/core/db';
import { renderCopy } from './creative/copy.js';
import { evaluateGate, type GateRefusal } from './gate.js';
import { enqueuePost } from './queue.js';

export interface PlanResult {
  queued: number;
  skipped: Array<{ offerId: string; platform: Platform; reason: GateRefusal | 'already_queued' }>;
}

/**
 * Public URL of the generated card. Instagram requires Meta to be able to
 * fetch it, so it points at the redirector rather than at a local file.
 */
export function imageUrlFor(shortHash: string, platform: Platform): string {
  const base = config.redirectBaseUrl.replace(/\/go\/?$/, '');
  return `${base}/img/${platform}/${shortHash}.png`;
}

async function alreadyQueued(offerId: string, platform: Platform): Promise<boolean> {
  const existing = await query(
    `SELECT 1 FROM posts WHERE offer_id = $1 AND platform = $2 AND status IN ('queued', 'published')`,
    [offerId, platform]
  );
  return Boolean(existing.rowCount);
}

/**
 * Turns an approved offer into queued posts.
 *
 * The gate runs here, before anything reaches the queue: an event that is not
 * approved, or outside the J-21..J-56 window, never becomes a job at all.
 */
export async function planPostsForOffer(
  event: Event,
  offer: Offer,
  platforms: Platform[] = ['facebook', 'instagram'],
  scheduledAt = new Date()
): Promise<PlanResult> {
  const result: PlanResult = { queued: 0, skipped: [] };

  const gate = evaluateGate(event, {
    humanApprovalRequired: config.humanApprovalRequired,
    publishWindow: config.publishWindow,
  });

  if (!gate.publishable) {
    for (const platform of platforms) {
      result.skipped.push({ offerId: offer.id, platform, reason: gate.refusal! });
    }
    logger.info('offer not publishable', { offerId: offer.id, reason: gate.refusal, daysUntil: gate.daysUntil });
    return result;
  }

  for (const platform of platforms) {
    if (await alreadyQueued(offer.id, platform)) {
      result.skipped.push({ offerId: offer.id, platform, reason: 'already_queued' });
      continue;
    }

    const copy = renderCopy({
      event,
      offer,
      platform,
      redirectBaseUrl: config.redirectBaseUrl,
    });

    await enqueuePost({
      offerId: offer.id,
      platform,
      copy: copy.text,
      imageUrl: imageUrlFor(offer.shortHash, platform),
      scheduledAt,
    });

    result.queued++;
  }

  return result;
}
