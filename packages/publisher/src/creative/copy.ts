import type { Event, Offer, Platform } from '@genia/core';

export type Locale = 'fr-CA' | 'en-CA';

/**
 * Copy language follows the origin we are selling *from*, not the destination:
 * the YUL offer is read by a Montreal audience, the YYZ one by a Toronto
 * audience. Offers are already built per origin, so this falls out cleanly.
 */
export function localeForOrigin(origin: string): Locale {
  return origin.toUpperCase() === 'YUL' ? 'fr-CA' : 'en-CA';
}

/**
 * Piège: the ad disclosure must live in the template, never be pasted in by
 * hand. It is prepended by `renderCopy` itself and asserted by the tests, so
 * copy without a disclosure cannot be produced by this module at all.
 */
export const DISCLOSURE: Record<Locale, string> = {
  'fr-CA': 'Publicité · lien affilié',
  'en-CA': 'Ad · affiliate link',
};

const HASHTAG: Record<Locale, string> = {
  'fr-CA': '#publicité',
  'en-CA': '#ad',
};

/** Instagram truncates captions past this; Facebook's limit is far higher. */
export const INSTAGRAM_CAPTION_LIMIT = 2200;

export interface CopyInput {
  event: Pick<Event, 'title' | 'city' | 'category' | 'startsAt'>;
  offer: Pick<Offer, 'origin' | 'shortHash' | 'checkIn' | 'checkOut'>;
  platform: Platform;
  redirectBaseUrl: string;
  locale?: Locale;
}

export interface CopyResult {
  text: string;
  locale: Locale;
  platform: Platform;
  /** Always returned. On Instagram it belongs in the bio/story, not the caption. */
  linkUrl: string;
  /** False on Instagram: captions are not linkified, so an inline URL is dead weight. */
  linkIsInCaption: boolean;
}

/**
 * Dates are formatted in UTC so output is deterministic and testable.
 * Known limitation: an event stored just after midnight UTC can render one day
 * early for a North American venue. Ticketmaster exposes a `localDate` we
 * currently discard in `RawEvent`; carrying it is the proper fix.
 */
function formatDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(date);
}

function formatNights(checkIn: string, checkOut: string, locale: Locale): string {
  const nights = Math.max(
    1,
    Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / (24 * 3600 * 1000))
  );
  if (locale === 'fr-CA') return nights === 1 ? '1 nuit' : `${nights} nuits`;
  return nights === 1 ? '1 night' : `${nights} nights`;
}

/** Stable pick so the same offer always renders the same variant. */
function variantIndex(seed: string, count: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % count;
}

type Hook = (ctx: { title: string; city: string; date: string }) => string;

/**
 * Every line interpolates only fields verified in the database: title, city,
 * dates. Nothing here asserts a price, an availability, or a discount — the
 * generator has no way to know those, and inventing them is exactly the
 * "embarrassing or false" failure the phase 3 milestone screens for.
 */
const HOOKS: Record<Locale, Hook[]> = {
  'fr-CA': [
    ({ title, city, date }) => `${title} à ${city}, le ${date}.`,
    ({ title, city }) => `Tu vas voir ${title} à ${city} ?`,
    ({ city, date }) => `${city}, le ${date}. Faut dormir quelque part.`,
  ],
  'en-CA': [
    ({ title, city, date }) => `${title} in ${city}, ${date}.`,
    ({ title, city }) => `Heading to ${title} in ${city}?`,
    ({ city, date }) => `${city}, ${date}. You'll need somewhere to stay.`,
  ],
};

const BODY: Record<Locale, (ctx: { city: string; nights: string }) => string> = {
  'fr-CA': ({ city, nights }) => `Compare les hôtels à ${city} pour ${nights} sur Expedia.`,
  'en-CA': ({ city, nights }) => `Compare hotels in ${city} for ${nights} on Expedia.`,
};

const CTA: Record<Locale, { withLink: (url: string) => string; inBio: string }> = {
  'fr-CA': {
    withLink: (url) => `👉 ${url}`,
    inBio: '👉 Lien dans la bio.',
  },
  'en-CA': {
    withLink: (url) => `👉 ${url}`,
    inBio: '👉 Link in bio.',
  },
};

export function renderCopy(input: CopyInput): CopyResult {
  const locale = input.locale ?? localeForOrigin(input.offer.origin);
  const linkUrl = `${input.redirectBaseUrl.replace(/\/$/, '')}/${input.offer.shortHash}`;

  // Instagram captions are not linkified — a pasted URL there is unclickable,
  // so the link is routed to the bio instead of dumped into the text.
  const linkIsInCaption = input.platform !== 'instagram';

  const ctx = {
    title: input.event.title,
    city: input.event.city,
    date: formatDate(input.event.startsAt, locale),
  };

  const hooks = HOOKS[locale];
  const hook = hooks[variantIndex(input.offer.shortHash, hooks.length)](ctx);
  const body = BODY[locale]({
    city: input.event.city,
    nights: formatNights(input.offer.checkIn, input.offer.checkOut, locale),
  });
  const cta = linkIsInCaption ? CTA[locale].withLink(linkUrl) : CTA[locale].inBio;

  const text = [`${DISCLOSURE[locale]}`, '', hook, body, '', cta, '', HASHTAG[locale]].join('\n');

  return { text, locale, platform: input.platform, linkUrl, linkIsInCaption };
}
