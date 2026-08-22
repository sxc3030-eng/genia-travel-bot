-- Affiliate reports are re-imported constantly: a conversion moves from
-- pending to approved to paid, and date ranges overlap between runs. Without a
-- stable key from the network, every re-import inserted the same booking again
-- and inflated revenue. `external_id` is the network's own transaction id.
ALTER TABLE conversions ADD COLUMN external_id text;

-- Backfill is not possible for rows imported before this column existed; there
-- are none in any deployed database yet, so the constraint can be added
-- directly. A NULL external_id is rejected outright rather than silently
-- allowed to duplicate.
ALTER TABLE conversions ALTER COLUMN external_id SET NOT NULL;
ALTER TABLE conversions ADD CONSTRAINT conversions_external_id_key UNIQUE (external_id);

-- Records which affiliate network a row came from, so two networks reusing the
-- same transaction id cannot collide once a second network is added.
ALTER TABLE conversions ADD COLUMN network text NOT NULL DEFAULT 'partnerize';
ALTER TABLE conversions DROP CONSTRAINT conversions_external_id_key;
ALTER TABLE conversions ADD CONSTRAINT conversions_network_external_id_key UNIQUE (network, external_id);
