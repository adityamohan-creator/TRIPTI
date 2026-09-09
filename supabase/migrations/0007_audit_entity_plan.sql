-- The audit trail could not name a response plan, so plan events were written
-- as 'mission' events carrying a plan id.
--
-- Two things break. A reviewer asking a mission for its history gets rows that
-- belong to something else, and asking a plan for its history gets nothing —
-- which is the opposite of what an append-only trail is for. The constraint was
-- the thing that was wrong; coercing the data to fit it was the wrong response.

alter table status_history drop constraint status_history_entity_type_check;

alter table status_history
  add constraint status_history_entity_type_check
  check (entity_type in ('incident', 'need', 'resource', 'mission', 'plan'));

-- Repair the rows already written. A plan id in the plans table is unambiguous:
-- ids are UUIDs from separate sequences, so a mission-labelled row whose id is a
-- known plan was mislabelled by this bug and by nothing else.
update status_history
set entity_type = 'plan'
where entity_type = 'mission'
  and entity_id in (select id from response_plans);

comment on constraint status_history_entity_type_check on status_history is
  'Extend this when a new entity gains a lifecycle worth auditing — never reuse an existing label for a different kind of id.';
