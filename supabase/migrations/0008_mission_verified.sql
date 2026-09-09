-- Adds the verified status.
--
-- Run this file ON ITS OWN and let it commit before 0009. Postgres will not let
-- a newly added enum value be *used* in the transaction that added it, and 0009
-- references 'verified' in a function body and an index predicate.
--
-- Delivery and verification are separate states on purpose: a delivery
-- confirmed only by the person who made it is not independently confirmed, and
-- impact figures are counted from verified missions.

alter type mission_status add value if not exists 'verified' after 'delivered';
