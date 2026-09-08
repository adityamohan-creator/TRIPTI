-- Fixes defects found in the Phase 0 audit, plus role-aware signup.
-- Run AFTER 0002_roles.sql has committed.
--
--   D1  profiles UPDATE policy recursed into profiles and could never run
--   D3  updated_at was set once at insert and never touched again
--   D10 every authenticated user could read every reporter's phone number

-- ------------------------------------------------------- role lookup helper

-- Reads the caller's role while bypassing RLS. Policies on other tables call
-- this instead of subquerying profiles directly, which keeps them cheap and
-- keeps profiles' own policies out of the picture.
create or replace function current_user_role() returns user_role
  language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

revoke all on function current_user_role() from public;
grant execute on function current_user_role() to authenticated;

-- ------------------------------------------------------------ D1: role pinning

-- The original policy tried to stop self-escalation with
--   with check (... and role = (select role from profiles where id = auth.uid()))
-- A policy on `profiles` that subqueries `profiles` makes Postgres raise
--   ERROR: infinite recursion detected in policy for relation "profiles"
-- so every browser-side profile update failed outright.
--
-- Same intent, enforced by a trigger instead: the role column is immutable from
-- the browser. Role changes go through the backend, which holds the service role
-- key and checks requireRole('admin') first.

drop policy if exists "own profile is updatable" on profiles;

create policy "own profile is updatable" on profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function pin_profile_role() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() is null when the service-role client is writing, and the backend
  -- has already authorized that path. Only constrain end users.
  if auth.uid() is not null and new.role is distinct from old.role then
    raise exception 'role cannot be changed here'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_pin_role on profiles;
create trigger profiles_pin_role
  before update on profiles
  for each row execute function pin_profile_role();

-- Coordinators and admins need to see who is on the roster.
create policy "staff read all profiles" on profiles
  for select using (current_user_role() in ('coordinator', 'admin'));

-- ------------------------------------------------------------ D3: updated_at

create or replace function set_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists incidents_set_updated_at on incidents;
create trigger incidents_set_updated_at
  before update on incidents
  for each row execute function set_updated_at();

drop trigger if exists missions_set_updated_at on missions;
create trigger missions_set_updated_at
  before update on missions
  for each row execute function set_updated_at();

-- ------------------------------------------------------- signup role selection

-- A new account may choose among the self-service roles only. Anything else
-- (including a crafted signup payload asking for 'admin') falls back to
-- 'citizen'. Elevated roles are granted by an admin through the backend.

create or replace function handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  requested text := new.raw_user_meta_data ->> 'role';
  resolved user_role := 'citizen';
begin
  if requested in ('citizen', 'volunteer', 'donor', 'ngo') then
    resolved := requested::user_role;
  end if;

  insert into public.profiles (id, full_name, phone, org, role)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    coalesce(new.phone, new.raw_user_meta_data ->> 'phone'),
    new.raw_user_meta_data ->> 'org',
    resolved
  );
  return new;
end;
$$;

-- ------------------------------------------------------------ D10: reporter PII

-- reporter_phone sat on `incidents`, whose select policy was
-- `using (auth.uid() is not null)` — so any signed-in account, including a
-- citizen, could read every reporter's phone number. PRD §18 says not to expose
-- citizen contact details unnecessarily.
--
-- Rather than trying to hide one column behind column grants (which breaks
-- `select *` and leaks through realtime payloads anyway), contact details move
-- to their own table with no policies at all. No policy means no row is visible
-- through the anon key, ever. Only the service-role backend can read it, and
-- only after its own role check.

create table incident_contacts (
  incident_id uuid primary key references incidents (id) on delete cascade,
  reporter_phone text,
  reporter_name text,
  created_at timestamptz not null default now()
);

alter table incident_contacts enable row level security;
-- Deliberately no policies. Backend-only.

insert into incident_contacts (incident_id, reporter_phone)
  select id, reporter_phone from incidents where reporter_phone is not null;

alter table incidents drop column reporter_phone;

-- With PII gone, the operational feed can stay broad — but a citizen still has
-- no business reading another citizen's raw report text.
drop policy if exists "authenticated users can read incidents" on incidents;

create policy "responders read all incidents" on incidents
  for select using (
    auth.uid() = reported_by
    or current_user_role() in ('volunteer', 'ngo', 'coordinator', 'admin')
  );
