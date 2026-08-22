import type { EventCategory, EventSource, RawEvent } from '@genia/core';

const API_BASE = 'https://app.ticketmaster.com/discovery/v2/events.json';
const PAGE_SIZE = 200;

/** Country codes covered by GEO_SCOPE=north_america. */
const NORTH_AMERICA = ['CA', 'US', 'MX'];

export interface TicketmasterOptions {
  apiKey: string;
  /** 'north_america' restricts to CA/US/MX; 'world' issues one unscoped query. */
  geoScope: 'north_america' | 'world';
  /** Only events starting within this many days are worth scanning. */
  horizonDays?: number;
  maxPages?: number;
  fetchImpl?: typeof fetch;
}

/** Shape of the slice of the Discovery API response we actually consume. */
interface TmVenue {
  name?: string;
  city?: { name?: string };
  country?: { countryCode?: string };
}

interface TmClassification {
  segment?: { name?: string };
  genre?: { name?: string };
}

interface TmEvent {
  name?: string;
  url?: string;
  dates?: { start?: { dateTime?: string; localDate?: string }; end?: { dateTime?: string; localDate?: string } };
  classifications?: TmClassification[];
  _embedded?: { venues?: TmVenue[] };
}

interface TmResponse {
  _embedded?: { events?: TmEvent[] };
  page?: { totalPages?: number; number?: number };
}

/**
 * Ticketmaster segments -> our four categories. Deliberately coarse: the
 * category only feeds the score's base weight, so a near miss costs a few
 * points, never a wrong destination.
 *
 * NOTE: we consume Ticketmaster purely as an event *signal* (city, dates,
 * scale). We never sell, resell, or link to tickets — the only monetised
 * link is the Expedia travel offer built in @genia/linkbuilder.
 */
export function mapCategory(event: TmEvent): EventCategory {
  const classification = event.classifications?.[0];
  const segment = classification?.segment?.name?.toLowerCase() ?? '';
  const genre = classification?.genre?.name?.toLowerCase() ?? '';
  const name = event.name?.toLowerCase() ?? '';

  if (name.includes('festival') || genre.includes('festival')) return 'festival';
  if (segment.includes('sport')) return 'sport';
  if (segment.includes('music')) return 'concert';
  if (segment.includes('arts') || segment.includes('theatre')) return 'festival';
  return 'congres';
}

function parseDate(date?: { dateTime?: string; localDate?: string }): Date | null {
  const raw = date?.dateTime ?? (date?.localDate ? `${date.localDate}T00:00:00Z` : undefined);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Maps one Discovery API event to our RawEvent, or null when a field we
 * cannot invent is missing (date, city, venue). Ticketmaster does not expose
 * venue capacity, so `capacity` is left undefined and scoring falls back to
 * its neutral default rather than guessing a number.
 */
export function mapTicketmasterEvent(event: TmEvent): RawEvent | null {
  const startsAt = parseDate(event.dates?.start);
  const venue = event._embedded?.venues?.[0];
  const city = venue?.city?.name;
  const country = venue?.country?.countryCode;

  if (!event.name || !startsAt || !city || !country) return null;

  const endsAt = parseDate(event.dates?.end);

  return {
    title: event.name,
    category: mapCategory(event),
    city,
    country,
    venue: venue?.name ?? 'Unknown venue',
    startsAt,
    ...(endsAt ? { endsAt } : {}),
    sourceUrl: event.url ?? '',
  };
}

export class TicketmasterSource implements EventSource {
  readonly name = 'ticketmaster';

  constructor(private readonly options: TicketmasterOptions) {
    if (!options.apiKey) {
      throw new Error('TICKETMASTER_API_KEY is required to run the ticketmaster source');
    }
  }

  private async fetchPage(countryCode: string | null, page: number): Promise<TmResponse> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const horizonDays = this.options.horizonDays ?? 120;
    const endDate = new Date(Date.now() + horizonDays * 24 * 3600 * 1000);

    const params = new URLSearchParams({
      apikey: this.options.apiKey,
      size: String(PAGE_SIZE),
      page: String(page),
      sort: 'date,asc',
      startDateTime: `${new Date().toISOString().slice(0, 19)}Z`,
      endDateTime: `${endDate.toISOString().slice(0, 19)}Z`,
    });
    if (countryCode) params.set('countryCode', countryCode);

    const response = await doFetch(`${API_BASE}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Ticketmaster API ${response.status}: ${await response.text()}`);
    }
    return (await response.json()) as TmResponse;
  }

  async fetch(): Promise<RawEvent[]> {
    const countries = this.options.geoScope === 'north_america' ? NORTH_AMERICA : [null];
    const maxPages = this.options.maxPages ?? 3;
    const collected: RawEvent[] = [];

    for (const country of countries) {
      for (let page = 0; page < maxPages; page++) {
        const body = await this.fetchPage(country, page);
        const events = body._embedded?.events ?? [];
        for (const event of events) {
          const mapped = mapTicketmasterEvent(event);
          if (mapped) collected.push(mapped);
        }
        const totalPages = body.page?.totalPages ?? 0;
        if (events.length === 0 || page + 1 >= totalPages) break;
      }
    }

    return collected;
  }
}
