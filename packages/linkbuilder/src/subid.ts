/**
 * Format fixed by the plan (section 4/6): evt{eventId}-{platform}-{yyyymmdd}.
 * `platform` is 'direct' when the subid is minted at offer-build time, before
 * any specific Facebook/Instagram post exists.
 */
export function buildSubid(eventId: string, platform: string, at: Date = new Date()): string {
  const yyyymmdd = at.toISOString().slice(0, 10).replace(/-/g, '');
  return `evt${eventId}-${platform}-${yyyymmdd}`;
}
