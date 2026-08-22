import { randomBytes } from 'node:crypto';
import { config, type Event, type Offer, type Route } from '@genia/core';
import { query } from '@genia/core/db';
import { buildAffiliateUrl, buildExpediaSearchUrl, buildOfferDates } from './expedia.js';
import { buildSubid } from './subid.js';

export { buildAffiliateUrl, buildExpediaSearchUrl, buildOfferDates } from './expedia.js';
export { buildSubid } from './subid.js';

interface OfferRow {
  id: string;
  event_id: string;
  origin: string;
  destination: string;
  check_in: string;
  check_out: string;
  product_type: string;
  target_url: string;
  short_hash: string;
  subid: string;
}

function mapOfferRow(row: OfferRow): Offer {
  return {
    id: row.id,
    eventId: row.event_id,
    origin: row.origin,
    destination: row.destination,
    checkIn: row.check_in,
    checkOut: row.check_out,
    productType: row.product_type as Offer['productType'],
    targetUrl: row.target_url,
    shortHash: row.short_hash,
    subid: row.subid,
  };
}

function generateShortHash(): string {
  return randomBytes(6).toString('base64url');
}

/** Contract from plan section 5: buildOffer(event, route) -> Offer, persisted. */
export async function buildOffer(event: Event, route: Route): Promise<Offer> {
  const { checkIn, checkOut } = buildOfferDates(event.startsAt, event.endsAt);
  const subid = buildSubid({ eventId: event.id, origin: route.origin, platform: 'direct' });

  const searchUrl = buildExpediaSearchUrl({
    destination: `${event.city}, ${event.country}`,
    checkIn,
    checkOut,
    productType: route.productType,
    pos: config.expedia.pos,
  });

  const targetUrl = buildAffiliateUrl(searchUrl, subid, {
    affiliateId: config.expedia.affiliateId,
    network: config.expedia.network,
    pos: config.expedia.pos,
  });

  let shortHash = generateShortHash();
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await query('SELECT 1 FROM offers WHERE short_hash = $1', [shortHash]);
    if (existing.rowCount === 0) break;
    shortHash = generateShortHash();
  }

  const result = await query<OfferRow>(
    `INSERT INTO offers (event_id, origin, destination, check_in, check_out, product_type, target_url, short_hash, subid)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [event.id, route.origin, route.destination, checkIn, checkOut, route.productType, targetUrl, shortHash, subid]
  );

  return mapOfferRow(result.rows[0]);
}

export interface MultiOriginOptions {
  /** Defaults to every configured ORIGIN_AIRPORTS entry (YUL + YYZ). */
  origins?: string[];
  productType?: Offer['productType'];
}

/**
 * We sell departures from both Montreal and Toronto, so an approved event
 * yields one offer per origin — each with its own short_hash and subid, so
 * clicks and conversions stay attributable to the origin that produced them.
 */
export async function buildOffersForEvent(event: Event, options: MultiOriginOptions = {}): Promise<Offer[]> {
  const origins = options.origins ?? config.originAirports;
  const productType = options.productType ?? 'hotel';
  const offers: Offer[] = [];

  for (const origin of origins) {
    offers.push(await buildOffer(event, { origin, destination: event.city, productType }));
  }

  return offers;
}
