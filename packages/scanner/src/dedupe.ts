import type { RawEvent } from '@genia/core';

/** Lowercase, accent-stripped, non-alphanumerics collapsed to a single `-`. */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function eventDateKey(startsAt: Date): string {
  return startsAt.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * `ville_date_slug` per plan section 4 — the UNIQUE constraint that stops the
 * exact same listing being stored twice (piège #2).
 *
 * The title slug is kept whole. An earlier version truncated it to four words
 * to absorb source-appended suffixes, but that silently failed whenever the
 * base title was shorter than four words ("Osheaga Festival" vs "Osheaga
 * Festival - presented by X" produced two different keys). Near-duplicates are
 * now handled by `isNearDuplicate` instead, which does not depend on title
 * length; this key stays exact so the DB constraint means what it says.
 */
export function buildDedupeKey(event: Pick<RawEvent, 'city' | 'startsAt' | 'title'>): string {
  return `${slugify(event.city)}_${eventDateKey(event.startsAt)}_${slugify(event.title)}`;
}

/** Words too generic to anchor a title match on their own. */
const MIN_ANCHOR_WORDS = 2;

/**
 * True when two title slugs for the same city+date describe the same event —
 * i.e. one is a word-boundary prefix of the other. Catches the common case of
 * one source appending promo text ("- presented by X", "featuring Y") that the
 * other omits, without depending on how many words the base title has.
 */
export function isNearDuplicate(slugA: string, slugB: string): boolean {
  if (slugA === slugB) return true;

  const [shorter, longer] = slugA.length <= slugB.length ? [slugA, slugB] : [slugB, slugA];
  if (shorter.split('-').length < MIN_ANCHOR_WORDS) return false;

  return longer.startsWith(`${shorter}-`);
}

function groupKey(event: Pick<RawEvent, 'city' | 'startsAt'>): string {
  return `${slugify(event.city)}_${eventDateKey(event.startsAt)}`;
}

/** Prefer the record carrying a capacity, then the more descriptive title. */
function isRicher(candidate: RawEvent, incumbent: RawEvent): boolean {
  const candidateHasCapacity = Boolean(candidate.capacity);
  const incumbentHasCapacity = Boolean(incumbent.capacity);
  if (candidateHasCapacity !== incumbentHasCapacity) return candidateHasCapacity;
  return candidate.title.length > incumbent.title.length;
}

/**
 * Collapses duplicates within one batch: same city + same date, and titles in a
 * prefix relation. Cross-batch/cross-run duplicates are caught by
 * `findExistingNearDuplicate` against the DB in `runScan`.
 */
export function dedupeBatch(events: RawEvent[]): RawEvent[] {
  const groups = new Map<string, RawEvent[]>();

  for (const event of events) {
    const key = groupKey(event);
    const bucket = groups.get(key);
    if (bucket) bucket.push(event);
    else groups.set(key, [event]);
  }

  const kept: RawEvent[] = [];

  for (const bucket of groups.values()) {
    const survivors: RawEvent[] = [];

    for (const event of bucket) {
      const slug = slugify(event.title);
      const matchIndex = survivors.findIndex((s) => isNearDuplicate(slugify(s.title), slug));

      if (matchIndex === -1) {
        survivors.push(event);
      } else if (isRicher(event, survivors[matchIndex])) {
        survivors[matchIndex] = event;
      }
    }

    kept.push(...survivors);
  }

  return kept;
}
