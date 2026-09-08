-- Align the role enum with the PRD's six roles.
--
-- Run this file ON ITS OWN and let it commit before running 0003. Postgres does
-- not allow a newly added enum value to be *used* in the same transaction that
-- added it, and 0003 references 'ngo'.
--
-- Mapping from the original enum to the PRD:
--   viewer      -> citizen            (PRD "Citizen")
--   volunteer   -> volunteer          (PRD "Volunteer")
--   donor       -> donor              (PRD "Food Donor")
--   (new) ngo   -> ngo                (PRD "NGO / Shelter")
--   coordinator -> coordinator        (PRD "Emergency Operator")
--   admin       -> admin              (PRD "Admin")

alter type user_role rename value 'viewer' to 'citizen';

-- Renaming leaves the column default pointing at the old label, so restate it.
alter table profiles alter column role set default 'citizen'::user_role;

alter type user_role add value if not exists 'ngo' after 'donor';
