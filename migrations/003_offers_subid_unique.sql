-- `conversions` joins back on `offers.subid` to attribute booking revenue, so
-- a duplicated subid silently misattributes money. Selling from two origins
-- (YUL + YYZ) means one event produces two offers, which is exactly the case
-- that used to collide before the origin was added to the subid.
ALTER TABLE offers ADD CONSTRAINT offers_subid_key UNIQUE (subid);
