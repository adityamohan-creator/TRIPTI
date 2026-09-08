-- TRIPTI initial schema.
-- Run in the Supabase SQL editor, or via `supabase db push` if you use the CLI.
--
-- Design notes:
--   * Every table has RLS enabled. The browser holds only the anon key, so
--     anything it can reach must be gated by a policy here.
--   * The backend uses the service role key and bypasses RLS entirely — it does
--     its own role checks in src/middleware/auth.ts.
--   * Coordinates are plain lat/lon columns, not PostGIS. Enable the postgis
--     extension and switch to geography(Point) once radius queries get heavy.

-- ---------------------------------------------------------------- enums

create type user_role as enum ('viewer', 'volunteer', 'donor', 'coordinator', 'admin');
create type severity as enum ('low', 'medium', 'high', 'critical');
create type incident_status as enum ('open', 'triaged', 'assigned', 'resolved');
create type need_status as enum ('unmet', 'partial', 'met', 'cancelled');
create type resource_status as enum ('available', 'committed', 'depleted', 'offline');
create type mission_status as enum ('proposed', 'accepted', 'en_route', 'delivered', 'failed', 'cancelled');

-- ---------------------------------------------------------------- profiles

-- One row per auth user. Role lives here, never in the JWT, so it can be revoked
-- without waiting for a token to expire.
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  phone text,
  role user_role not null default 'viewer',
  org text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "own profile is readable" on profiles
  for select using (auth.uid() = id);

create policy "own profile is updatable" on profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id and role = (select role from profiles where id = auth.uid()));

-- New signups get a viewer profile automatically.
create function handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.phone);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------- incidents

create table incidents (
  id uuid primary key default gen_random_uuid(),
  report_text text not null,
  reporter_phone text,
  reported_by uuid references profiles (id),

  -- AI-extracted, human-correctable. Never treated as authoritative on its own.
  summary text,
  category text,
  severity severity not null default 'medium',
  location_text text,
  people_affected integer check (people_affected >= 0),
  source_language text,
  ai_confidence numeric(3, 2) check (ai_confidence between 0 and 1),
  ai_unclear jsonb not null default '[]'::jsonb,

  lat double precision check (lat between -90 and 90),
  lon double precision check (lon between -180 and 180),

  status incident_status not null default 'open',
  triaged_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index incidents_status_created_idx on incidents (status, created_at desc);
create index incidents_severity_idx on incidents (severity);

alter table incidents enable row level security;

create policy "authenticated users can read incidents" on incidents
  for select using (auth.uid() is not null);

-- ---------------------------------------------------------------- needs

create table needs (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents (id) on delete cascade,
  kind text not null,
  quantity numeric check (quantity >= 0),
  unit text,
  note text,
  status need_status not null default 'unmet',
  created_at timestamptz not null default now()
);

create index needs_status_kind_idx on needs (status, kind);
create index needs_incident_idx on needs (incident_id);

alter table needs enable row level security;

create policy "authenticated users can read needs" on needs
  for select using (auth.uid() is not null);

-- ---------------------------------------------------------------- resources

create table resources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles (id),
  label text not null,
  kind text not null,
  -- Null means unmetered: a rescue team, a doctor, a boat.
  quantity numeric check (quantity >= 0),
  unit text,
  lat double precision check (lat between -90 and 90),
  lon double precision check (lon between -180 and 180),
  status resource_status not null default 'available',
  created_at timestamptz not null default now()
);

create index resources_status_kind_idx on resources (status, kind);

alter table resources enable row level security;

create policy "authenticated users can read resources" on resources
  for select using (auth.uid() is not null);

create policy "owners manage their own resources" on resources
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------- missions

create table missions (
  id uuid primary key default gen_random_uuid(),
  need_id uuid not null references needs (id) on delete cascade,
  resource_id uuid not null references resources (id),
  assigned_to uuid references profiles (id),
  quantity numeric check (quantity >= 0),

  -- Why the engine proposed this pairing. Kept for post-incident audit.
  distance_km numeric,
  need_priority numeric,

  status mission_status not null default 'proposed',
  created_by uuid references profiles (id),
  route jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index missions_status_idx on missions (status);
create index missions_assignee_idx on missions (assigned_to);

alter table missions enable row level security;

create policy "authenticated users can read missions" on missions
  for select using (auth.uid() is not null);

create policy "assignees update their own missions" on missions
  for update using (auth.uid() = assigned_to) with check (auth.uid() = assigned_to);

-- ---------------------------------------------------------------- status history

-- Append-only audit trail. Nothing here is ever updated or deleted, so a
-- post-incident review can reconstruct exactly what was known when.
create table status_history (
  id bigserial primary key,
  entity_type text not null check (entity_type in ('incident', 'need', 'resource', 'mission')),
  entity_id uuid not null,
  from_status text,
  to_status text not null,
  changed_by uuid references profiles (id),
  note text,
  changed_at timestamptz not null default now()
);

create index status_history_entity_idx on status_history (entity_type, entity_id, changed_at desc);

alter table status_history enable row level security;

create policy "authenticated users can read history" on status_history
  for select using (auth.uid() is not null);

-- ---------------------------------------------------------------- realtime

-- Publish the tables the dashboards subscribe to.
alter publication supabase_realtime add table incidents;
alter publication supabase_realtime add table needs;
alter publication supabase_realtime add table missions;
