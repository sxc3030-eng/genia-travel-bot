import type { ProductType } from '@genia/core';

export interface AffiliateOptions {
  affiliateId: string;
  network: 'partnerize' | 'impact';
  pos: string;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** J-1 / J+1 around the event, per plan section 4. */
export function buildOfferDates(
  eventStartsAt: Date,
  eventEndsAt: Date | null
): { checkIn: string; checkOut: string } {
  const checkIn = addDays(eventStartsAt, -1);
  const checkOut = addDays(eventEndsAt ?? eventStartsAt, 1);
  return { checkIn: isoDate(checkIn), checkOut: isoDate(checkOut) };
}

export function buildExpediaSearchUrl(params: {
  destination: string;
  checkIn: string;
  checkOut: string;
  productType: ProductType;
  pos: string;
}): string {
  const domain = params.pos === 'CA' ? 'www.expedia.ca' : 'www.expedia.com';
  const path = params.productType === 'flight_hotel' ? '/Vacation-Packages-Search' : '/Hotel-Search';
  const search = new URLSearchParams({
    destination: params.destination,
    startDate: params.checkIn,
    endDate: params.checkOut,
    adults: '2',
  });
  return `https://${domain}${path}?${search.toString()}`;
}

/**
 * Wraps a raw Expedia URL in the configured affiliate network's click-tracking
 * link. The exact tracking domain and query-param names must be confirmed
 * against the signed affiliate agreement before going live — these follow
 * each network's publicly documented deep-link shape and are here to keep
 * the affiliate id and subid traceable end to end.
 */
export function buildAffiliateUrl(targetUrl: string, subid: string, options: AffiliateOptions): string {
  const encodedTarget = encodeURIComponent(targetUrl);
  const encodedSubid = encodeURIComponent(subid);

  switch (options.network) {
    case 'partnerize':
      return `https://prf.hn/click/camref:${options.affiliateId}/pubref:${encodedSubid}/destination:${encodedTarget}`;
    case 'impact':
      return `https://expedia.sjv.io/c/${options.affiliateId}/click?subId1=${encodedSubid}&u=${encodedTarget}`;
    default: {
      const exhaustive: never = options.network;
      throw new Error(`Unknown affiliate network: ${String(exhaustive)}`);
    }
  }
}
