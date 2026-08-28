-- Piège #6: re-verify an event at J-7 and unpublish it if it was cancelled.
-- Re-checking requires asking the source about a specific event, which needs
-- the source's own id — `source_url` is not a stable API handle. Nullable
-- because rows scanned before this column existed cannot be backfilled; the
-- re-verification job skips those rather than guessing.
ALTER TABLE events ADD COLUMN source_event_id text;
CREATE INDEX events_source_event_id_idx ON events (source, source_event_id);

-- Set when a re-check finds the event cancelled or postponed, so the job does
-- not keep re-processing it and the analytics can exclude it.
ALTER TABLE events ADD COLUMN verified_at timestamptz;

-- Durable alerts. Logging alone loses them: the phase 6 milestone is seven days
-- unattended, which only works if a failure is still visible afterwards.
CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  severity text NOT NULL,
  message text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX alerts_unresolved_idx ON alerts (kind, created_at DESC) WHERE resolved_at IS NULL;
