import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

// Resolve the repo-root .env regardless of which workspace package invokes
// this module (npm workspace scripts run with cwd set to the sub-package).
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../../.env') });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  expedia: {
    affiliateId: required('EXPEDIA_AFFILIATE_ID'),
    network: (process.env.EXPEDIA_NETWORK ?? 'partnerize') as 'partnerize' | 'impact',
    pos: process.env.EXPEDIA_POS ?? 'CA',
  },
  redirectBaseUrl: process.env.REDIRECT_BASE_URL ?? 'http://localhost:3000/go',
  // Decisions — plan section 7 (docs/PLAN.md)
  originAirports: (process.env.ORIGIN_AIRPORTS ?? 'YUL,YYZ').split(',').map((s) => s.trim()),
  geoScope: (process.env.GEO_SCOPE ?? 'north_america') as 'north_america' | 'world',
  humanApprovalRequired: (process.env.HUMAN_APPROVAL_REQUIRED ?? 'true') === 'true',
  eventSourcePrimary: process.env.EVENT_SOURCE_PRIMARY ?? 'ticketmaster',
  // Not `required()`: only the scanner needs it, and the redirector must boot without it.
  ticketmasterApiKey: process.env.TICKETMASTER_API_KEY ?? '',
  meta: {
    appId: process.env.META_APP_ID ?? '',
    appSecret: process.env.META_APP_SECRET ?? '',
    pageId: process.env.META_PAGE_ID ?? '',
    pageToken: process.env.META_PAGE_TOKEN ?? '',
    igBusinessId: process.env.IG_BUSINESS_ID ?? '',
  },
  maxPostsPerDay: Number(process.env.MAX_POSTS_PER_DAY ?? 4),
  publishWindow: {
    minDays: Number(process.env.PUBLISH_WINDOW_MIN_DAYS ?? 21),
    maxDays: Number(process.env.PUBLISH_WINDOW_MAX_DAYS ?? 56),
  },
  port: Number(process.env.PORT ?? 3000),
};
