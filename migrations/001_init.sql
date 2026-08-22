CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text UNIQUE NOT NULL,
  title text NOT NULL,
  category text NOT NULL,
  city text NOT NULL,
  country text NOT NULL,
  venue text NOT NULL,
  capacity int,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  source text NOT NULL,
  source_url text NOT NULL,
  score numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_status_score_idx ON events (status, score DESC);

CREATE TABLE offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events (id),
  origin text NOT NULL,
  destination text NOT NULL,
  check_in date NOT NULL,
  check_out date NOT NULL,
  product_type text NOT NULL,
  target_url text NOT NULL,
  short_hash text UNIQUE NOT NULL,
  subid text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX offers_event_id_idx ON offers (event_id);

CREATE TABLE posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES offers (id),
  platform text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  external_id text,
  scheduled_at timestamptz,
  published_at timestamptz,
  error text,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX posts_offer_id_idx ON posts (offer_id);
CREATE INDEX posts_status_idx ON posts (status);

CREATE TABLE clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES offers (id),
  post_id uuid REFERENCES posts (id),
  ip_hash text NOT NULL,
  user_agent text,
  referer text,
  clicked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX clicks_offer_id_idx ON clicks (offer_id);

CREATE TABLE conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subid text NOT NULL,
  booking_value numeric NOT NULL,
  commission numeric NOT NULL,
  currency text NOT NULL,
  status text NOT NULL,
  booked_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX conversions_subid_idx ON conversions (subid);
