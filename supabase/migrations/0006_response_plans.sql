-- Response plans, and the reservation that makes them safe.
--
-- Closes D7 from the Phase 0 audit: the match preview read `resources.quantity`
-- and ignored what other plans had already promised, so two coordinators
-- working minutes apart could each be told the same 400 meals were theirs.

create type plan_status as enum ('proposed', 'approved', 'discarded');

-- ------------------------------------------------------ atomic reservation

/*
 * Reserve stock, or refuse.
 *
 * The check and the increment happen in one statement so two concurrent callers
 * cannot both read "70 available" and both commit 70. Postgres takes a row lock
 * for the UPDATE; the loser sees the winner's value and its WHERE clause fails,
 * which is reported as false rather than raised — the caller is expected to
 * handle losing the race, because losing it is normal.
 *
 * A null quantity is unmetered (a rescue team, a doctor): always reservable,
 * and reserving it changes nothing.
 */
create or replace function reserve_resource(p_resource_id uuid, p_amount numeric)
  returns boolean
  language plpgsql security definer set search_path = public as $$
declare
  updated integer;
begin
  if p_amount is null then
    return exists (select 1 from resources where id = p_resource_id);
  end if;

  if p_amount < 0 then
    raise exception 'cannot reserve a negative amount';
  end if;

  update resources
  set reserved_quantity = reserved_quantity + p_amount
  where id = p_resource_id
    and (quantity is null or reserved_quantity + p_amount <= quantity);

  get diagnostics updated = row_count;
  return updated = 1;
end;
$$;

/*
 * Give stock back when a plan is discarded or a mission fails.
 *
 * Clamped at zero: a double release is a bug worth fixing, but it must not
 * leave the column negative and poison every later availability calculation.
 */
create or replace function release_resource(p_resource_id uuid, p_amount numeric)
  returns void
  language plpgsql security definer set search_path = public as $$
begin
  if p_amount is null then return; end if;

  update resources
  set reserved_quantity = greatest(0, reserved_quantity - p_amount)
  where id = p_resource_id;
end;
$$;

revoke all on function reserve_resource(uuid, numeric) from public, anon, authenticated;
revoke all on function release_resource(uuid, numeric) from public, anon, authenticated;

-- ------------------------------------------------------------ plans

create table response_plans (
  id uuid primary key default gen_random_uuid(),
  label text,
  status plan_status not null default 'proposed',

  -- What the engine saw and decided, kept verbatim. A plan approved on Tuesday
  -- has to be explainable on Friday, by which time the pool has moved on.
  weights jsonb not null default '{}'::jsonb,
  unmatched jsonb not null default '[]'::jsonb,
  coverage numeric check (coverage between 0 and 1),

  created_by uuid references profiles (id),
  approved_by uuid references profiles (id),
  approved_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index response_plans_status_idx on response_plans (status, created_at desc);

alter table response_plans enable row level security;

create trigger response_plans_set_updated_at
  before update on response_plans
  for each row execute function set_updated_at();

create policy "responders read plans" on response_plans
  for select using (
    current_user_role() in ('volunteer', 'ngo', 'coordinator', 'admin')
  );

-- Matches now belong to a plan. Nullable so a bare preview can still be stored
-- for audit without inventing a plan around it.
alter table matches add column plan_id uuid references response_plans (id) on delete cascade;
create index matches_plan_idx on matches (plan_id);

-- Missions trace back to the plan that authorised them.
alter table missions add column plan_id uuid references response_plans (id);

alter publication supabase_realtime add table response_plans;
