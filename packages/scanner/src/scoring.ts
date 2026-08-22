import type { EventCategory, RawEvent } from '@genia/core';

export interface ScoringOptions {
  /** Cities we sell *from* — an event there is not a travel opportunity. */
  originCities: string[];
  publishWindow: { minDays: number; maxDays: number };
  now?: Date;
}

/** Airport code -> city name, so origin config drives the scoring penalty. */
export const ORIGIN_CITY_BY_AIRPORT: Record<string, string> = {
  YUL: 'Montreal',
  YYZ: 'Toronto',
  YVR: 'Vancouver',
  YOW: 'Ottawa',
  YQB: 'Quebec City',
};

export function originCitiesFor(airports: string[]): string[] {
  return airports.map((code) => ORIGIN_CITY_BY_AIRPORT[code.toUpperCase()]).filter((c): c is string => Boolean(c));
}

function normalizeCity(city: string): string {
  return city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** 0–30. Festivals and big sports pull multi-night stays; congresses are shorter. */
const CATEGORY_BASE: Record<EventCategory, number> = {
  festival: 30,
  sport: 26,
  concert: 24,
  congres: 20,
};

/** 0–25, log-scaled. Unknown capacity gets a neutral middle score, not a zero. */
export function capacityScore(capacity: number | null | undefined): number {
  if (!capacity || capacity <= 0) return 12;
  const scaled = (Math.log10(capacity) - 3) / (Math.log10(80000) - 3);
  return Math.max(0, Math.min(1, scaled)) * 25;
}

/**
 * 0–25. Full marks inside the publish window (J-21..J-56 by default), tapering
 * on both sides: too soon and the booking window has closed, too far out and
 * the post is forgotten before anyone travels.
 */
export function leadTimeScore(
  daysUntil: number,
  window: { minDays: number; maxDays: number }
): number {
  if (daysUntil < 0) return 0;
  if (daysUntil >= window.minDays && daysUntil <= window.maxDays) return 25;
  if (daysUntil < window.minDays) return Math.max(0, (daysUntil / window.minDays) * 15);
  const overshoot = daysUntil - window.maxDays;
  return Math.max(0, 20 - overshoot * 0.15);
}

/**
 * 0–20. An event in one of our own origin cities is worth almost nothing:
 * the audience already lives there and books no hotel.
 */
export function destinationScore(city: string, originCities: string[]): number {
  const target = normalizeCity(city);
  const isOrigin = originCities.some((origin) => normalizeCity(origin) === target);
  return isOrigin ? 0 : 20;
}

export function daysUntil(startsAt: Date, now: Date): number {
  return Math.floor((startsAt.getTime() - now.getTime()) / (24 * 3600 * 1000));
}

/** Composite 0–100. Every component is exported so the weighting stays auditable. */
export function scoreEvent(event: RawEvent, options: ScoringOptions): number {
  const now = options.now ?? new Date();
  const score =
    CATEGORY_BASE[event.category] +
    capacityScore(event.capacity) +
    leadTimeScore(daysUntil(event.startsAt, now), options.publishWindow) +
    destinationScore(event.city, options.originCities);

  return Math.round(Math.max(0, Math.min(100, score)) * 100) / 100;
}
