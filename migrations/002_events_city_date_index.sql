-- Supports the scanner's cross-run near-duplicate lookup, which scopes to one
-- UTC day with an explicit half-open range:
--   SELECT ... FROM events WHERE city = $1 AND starts_at >= $2 AND starts_at < $3
--
-- Plain columns on purpose: an expression index on `(starts_at::date)` is
-- rejected, because casting timestamptz to date depends on the session
-- TimeZone and is therefore only STABLE, not IMMUTABLE.
CREATE INDEX events_city_starts_at_idx ON events (city, starts_at);
