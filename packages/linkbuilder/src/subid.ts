export interface SubidParts {
  eventId: string;
  /** Origin airport code — the offer is per-origin, so the subid must be too. */
  origin: string;
  /** 'direct' when minted at offer-build time, before any FB/IG post exists. */
  platform: string;
  at?: Date;
}

/**
 * Plan section 4 specifies `evt{id}-{platform}-{yyyymmdd}`. We additionally
 * carry the origin, because selling from both YUL and YYZ means one event
 * yields one offer per origin — and `conversions` joins back on
 * `offers.subid`. Without the origin those two offers share a subid and
 * booking revenue cannot be attributed to the origin that produced it.
 */
export function buildSubid({ eventId, origin, platform, at = new Date() }: SubidParts): string {
  const yyyymmdd = at.toISOString().slice(0, 10).replace(/-/g, '');
  return `evt${eventId}-${origin.toLowerCase()}-${platform}-${yyyymmdd}`;
}
