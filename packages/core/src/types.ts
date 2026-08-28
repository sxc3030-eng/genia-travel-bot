export type EventCategory = 'concert' | 'sport' | 'festival' | 'congres';
export type EventStatus = 'new' | 'approved' | 'rejected' | 'published';

export interface Event {
  id: string;
  dedupeKey: string;
  title: string;
  category: EventCategory;
  city: string;
  country: string;
  venue: string;
  capacity: number | null;
  startsAt: Date;
  endsAt: Date | null;
  source: string;
  sourceUrl: string;
  score: number;
  status: EventStatus;
  createdAt: Date;
}

export type ProductType = 'hotel' | 'flight_hotel';

export interface Offer {
  id: string;
  eventId: string;
  origin: string;
  destination: string;
  checkIn: string;
  checkOut: string;
  productType: ProductType;
  targetUrl: string;
  shortHash: string;
  subid: string;
}

export interface Route {
  origin: string;
  destination: string;
  productType: ProductType;
}

export type Platform = 'facebook' | 'instagram';
export type PostStatus = 'queued' | 'published' | 'failed';

export interface Post {
  id: string;
  offerId: string;
  platform: Platform;
  status: PostStatus;
  externalId: string | null;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  error: string | null;
  attempts: number;
}

export interface Click {
  id: string;
  offerId: string;
  postId: string | null;
  ipHash: string;
  userAgent: string | null;
  referer: string | null;
  clickedAt: Date;
}

export interface Conversion {
  id: string;
  subid: string;
  bookingValue: number;
  commission: number;
  currency: string;
  status: string;
  bookedAt: Date;
}

// ---- Cross-module contracts (plan section 5) ----

export interface RawEvent {
  title: string;
  category: EventCategory;
  city: string;
  country: string;
  venue: string;
  capacity?: number;
  startsAt: Date;
  endsAt?: Date;
  sourceUrl: string;
  /** The source's own id, needed to re-verify the event at J-7 (piège #6). */
  sourceEventId?: string;
}

export interface EventSource {
  name: string;
  fetch(): Promise<RawEvent[]>;
}

export interface PostJob {
  offerId: string;
  platform: Platform;
  copy: string;
  imageUrl: string;
  scheduledAt: Date;
}
