-- Live fleet and live history.
--
-- `vehicles`, `volunteers` and `status_history` were the three tables the
-- dashboards read but never heard about. A vehicle moving, a volunteer going
-- off duty, or a mission changing hands would sit invisible on an open map
-- until someone reloaded — and a coordinator watching a map has no reason to
-- suspect it has stopped telling the truth.
--
-- Realtime enforces row level security per subscriber, so publishing a table
-- does not widen who can see what: each client receives only the rows its own
-- policies already allow it to select. The policies on all three are unchanged
-- by this migration, deliberately.
--
-- `status_history` is append-only, so subscribers see inserts and nothing else
-- — which is exactly what a live mission timeline wants.

do $$ begin
  alter publication supabase_realtime add table vehicles;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table volunteers;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table status_history;
exception when duplicate_object then null;
end $$;

-- ------------------------------------------------- deletes that must be seen

/*
 * Make deleted resources disappear from open screens.
 *
 * With the default replica identity a DELETE carries only the primary key, so
 * Realtime cannot evaluate row level security against the row that went away
 * and drops the event rather than risk leaking it. Subscribers are told
 * nothing. Measured, not assumed: deleting a resource left it drawn on an open
 * map while the database no longer had it.
 *
 * REPLICA IDENTITY FULL puts the old row in the WAL so the policy can be
 * checked and the event delivered.
 *
 * Only `resources`. It is the one table the application actually deletes from
 * — a donor withdrawing a listing. Everything else transitions status instead:
 * incidents resolve, missions cancel, matches release. Setting this everywhere
 * would pay the extra WAL volume on every table to fix a case that only arises
 * in the seed script's reset, where a page refresh is a perfectly good answer.
 *
 * Stale supply is worth the cost: a coordinator planning against stock that no
 * longer exists dispatches someone to collect nothing.
 */
alter table resources replica identity full;
