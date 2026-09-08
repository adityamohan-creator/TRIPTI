-- The operational half of the schema: who can carry things, what carries them,
-- what was matched to what, and what it added up to.
--
-- Entity names follow the PRD's §11 database design. One deliberate deviation is
-- documented at `resources.expiry_time` below.

-- ------------------------------------------------------------------ enums

create type availability as enum ('available', 'busy', 'offline');
create type vehicle_type as enum ('bike', 'car', 'van', 'truck', 'boat', 'other');
create type match_status as enum ('proposed', 'reserved', 'committed', 'released', 'fulfilled');
create type stop_kind as enum ('pickup', 'dropoff');

-- ------------------------------------------------------------- resources

-- The PRD's entity list has one `resources` table carrying `expiry_time`, so
-- surplus food is not a separate parallel supply model — it is a resource whose
-- kind is 'food' and which happens to expire. That keeps the matching engine
-- operating over a single pool rather than reconciling two, and food rescue
-- becomes a filter plus a scoring term rather than a second subsystem.
alter table resources add column description text;
alter table resources add column address text;
alter table resources add column expiry_time timestamptz;
alter table resources add column perishable boolean not null default false;

-- Quantity already promised to a match but not yet delivered. Availability is
-- (quantity - reserved_quantity), never quantity alone — otherwise two previews
-- run minutes apart can promise the same units twice.
alter table resources add column reserved_quantity numeric not null default 0
  check (reserved_quantity >= 0);

alter table resources add constraint resources_reserved_within_quantity
  check (quantity is null or reserved_quantity <= quantity);

alter table resources add column updated_at timestamptz not null default now();

create trigger resources_set_updated_at
  before update on resources
  for each row execute function set_updated_at();

create index resources_expiry_idx on resources (expiry_time)
  where expiry_time is not null;
create index resources_owner_idx on resources (owner_id);

create policy "staff manage resources" on resources
  for all using (current_user_role() in ('coordinator', 'admin'))
  with check (current_user_role() in ('coordinator', 'admin'));

-- ------------------------------------------------------------ volunteers

-- One row per volunteering profile. Separate from `profiles` because these
-- fields change constantly during a response and most accounts never have them.
create table volunteers (
  user_id uuid primary key references profiles (id) on delete cascade,
  skills text[] not null default '{}',
  vehicle_id uuid,
  availability availability not null default 'offline',
  lat double precision check (lat between -90 and 90),
  lon double precision check (lon between -180 and 180),
  -- Capped so the assigner cannot pile every mission onto one willing person.
  max_concurrent_missions integer not null default 1
    check (max_concurrent_missions between 1 and 10),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index volunteers_availability_idx on volunteers (availability);

alter table volunteers enable row level security;

create trigger volunteers_set_updated_at
  before update on volunteers
  for each row execute function set_updated_at();

create policy "volunteers manage their own record" on volunteers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "staff read volunteers" on volunteers
  for select using (current_user_role() in ('coordinator', 'admin'));

create policy "staff update volunteers" on volunteers
  for update using (current_user_role() in ('coordinator', 'admin'));

-- -------------------------------------------------------------- vehicles

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles (id) on delete set null,
  label text not null,
  type vehicle_type not null default 'van',
  capacity_kg numeric check (capacity_kg >= 0),
  capacity_units numeric check (capacity_units >= 0),
  refrigerated boolean not null default false,
  availability availability not null default 'available',
  lat double precision check (lat between -90 and 90),
  lon double precision check (lon between -180 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vehicles_availability_idx on vehicles (availability);

alter table vehicles enable row level security;

create trigger vehicles_set_updated_at
  before update on vehicles
  for each row execute function set_updated_at();

create policy "owners manage their vehicles" on vehicles
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "responders read vehicles" on vehicles
  for select using (
    current_user_role() in ('volunteer', 'ngo', 'coordinator', 'admin')
  );

alter table volunteers
  add constraint volunteers_vehicle_fk
  foreign key (vehicle_id) references vehicles (id) on delete set null;

-- --------------------------------------------------------------- matches

-- A proposed or committed pairing of one need with one resource. The engine
-- produces these; a coordinator promotes them to missions. Kept as its own table
-- so a plan can be reviewed, revised and audited before anything dispatches.
create table matches (
  id uuid primary key default gen_random_uuid(),
  need_id uuid not null references needs (id) on delete cascade,
  resource_id uuid not null references resources (id) on delete cascade,
  score numeric not null,
  allocated_quantity numeric check (allocated_quantity >= 0),
  distance_km numeric,
  -- The per-term breakdown behind `score`. A coordinator has to be able to ask
  -- "why this one" and get an answer, so the reasoning is stored, not recomputed.
  rationale jsonb not null default '{}'::jsonb,
  status match_status not null default 'proposed',
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live pairing per need/resource. A released or fulfilled row is history and
-- may repeat, so the constraint only covers the states that hold inventory.
create unique index matches_active_pair_idx on matches (need_id, resource_id)
  where status in ('proposed', 'reserved', 'committed');
create index matches_need_idx on matches (need_id);
create index matches_status_idx on matches (status);

alter table matches enable row level security;

create trigger matches_set_updated_at
  before update on matches
  for each row execute function set_updated_at();

create policy "responders read matches" on matches
  for select using (
    current_user_role() in ('volunteer', 'ngo', 'coordinator', 'admin')
  );

-- ------------------------------------------------- missions: stops + routes

alter table missions add column vehicle_id uuid references vehicles (id);
alter table missions add column match_id uuid references matches (id);
alter table missions add column verified_at timestamptz;
alter table missions add column verified_by uuid references profiles (id);
alter table missions add column verification_note text;

create table mission_stops (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references missions (id) on delete cascade,
  seq integer not null check (seq >= 0),
  kind stop_kind not null,
  label text not null,
  address text,
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  arrived_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (mission_id, seq)
);

create index mission_stops_mission_idx on mission_stops (mission_id, seq);

alter table mission_stops enable row level security;

create policy "responders read stops" on mission_stops
  for select using (
    current_user_role() in ('volunteer', 'ngo', 'coordinator', 'admin')
  );

create table routes (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null unique references missions (id) on delete cascade,
  distance_km numeric,
  duration_min numeric,
  -- GeoJSON LineString from whichever provider ran, or a straight-line fallback.
  geometry jsonb,
  provider text not null default 'fallback',
  optimization_score numeric,
  created_at timestamptz not null default now()
);

alter table routes enable row level security;

create policy "responders read routes" on routes
  for select using (
    current_user_role() in ('volunteer', 'ngo', 'coordinator', 'admin')
  );

-- -------------------------------------------------------- impact metrics

create table impact_metrics (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references incidents (id) on delete cascade,
  mission_id uuid references missions (id) on delete cascade,
  people_helped integer not null default 0 check (people_helped >= 0),
  meals_delivered integer not null default 0 check (meals_delivered >= 0),
  water_litres numeric not null default 0 check (water_litres >= 0),
  food_kg_rescued numeric not null default 0 check (food_kg_rescued >= 0),
  -- Minutes from the incident being reported to this delivery being verified.
  response_minutes numeric check (response_minutes >= 0),
  recorded_at timestamptz not null default now(),
  -- A metric that belongs to nothing cannot be attributed, and an unattributed
  -- impact number is a number nobody can check.
  constraint impact_has_subject check (incident_id is not null or mission_id is not null)
);

create index impact_incident_idx on impact_metrics (incident_id);

alter table impact_metrics enable row level security;

create policy "authenticated users read impact" on impact_metrics
  for select using (auth.uid() is not null);

-- --------------------------------------------------------- notifications

create table notifications (
  id bigserial primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on notifications (user_id, created_at desc);

alter table notifications enable row level security;

create policy "own notifications are readable" on notifications
  for select using (auth.uid() = user_id);

-- Marking one read is the only field a recipient may change; the trigger below
-- stops the update policy from being a way to rewrite the message itself.
create policy "own notifications are markable" on notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function pin_notification_content() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.kind := old.kind;
    new.title := old.title;
    new.body := old.body;
    new.link := old.link;
    new.user_id := old.user_id;
  end if;
  return new;
end;
$$;

create trigger notifications_pin_content
  before update on notifications
  for each row execute function pin_notification_content();

-- -------------------------------------------------------------- realtime

alter publication supabase_realtime add table matches;
alter publication supabase_realtime add table resources;
alter publication supabase_realtime add table notifications;
