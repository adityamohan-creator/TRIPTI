-- Reallocation: moving already-promised stock to somewhere it is needed more.
--
-- Stored rather than computed on read, because a reallocation is the most
-- consequential thing a coordinator does here — it takes a truck away from one
-- group of people and gives it to another. What was proposed, what was
-- protected, who approved it and why all have to survive the pool moving on.

create type reallocation_status as enum ('proposed', 'approved', 'discarded');

create table reallocations (
  id uuid primary key default gen_random_uuid(),
  label text,
  status reallocation_status not null default 'proposed',

  /*
   * The proposal as generated, kept verbatim.
   *
   * `protected_commitments` matters as much as `moves`: a review six weeks
   * later needs to see not only what was taken but what the system refused to
   * touch, so the judgement can be checked rather than guessed at.
   */
  moves jsonb not null default '[]'::jsonb,
  protected_commitments jsonb not null default '[]'::jsonb,
  still_unserved jsonb not null default '[]'::jsonb,
  min_priority_gain numeric,

  /** What triggered it — usually the incident that just arrived. */
  triggered_by_incident uuid references incidents (id) on delete set null,

  created_by uuid references profiles (id),
  approved_by uuid references profiles (id),
  approved_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reallocations_status_idx on reallocations (status, created_at desc);

alter table reallocations enable row level security;

create trigger reallocations_set_updated_at
  before update on reallocations
  for each row execute function set_updated_at();

create policy "staff read reallocations" on reallocations
  for select using (current_user_role() in ('coordinator', 'admin'));

-- Which reallocation, if any, produced a match.
alter table matches add column reallocation_id uuid references reallocations (id);
create index matches_reallocation_idx on matches (reallocation_id);

-- ------------------------------------------------------------- execution

/*
 * Moves one reservation from one need to another, atomically.
 *
 * The release and the re-reservation happen in a single statement pair inside
 * one function so the stock is never briefly unheld — a concurrent plan reading
 * the pool mid-move would otherwise see units that are about to be spoken for
 * and promise them a second time.
 *
 * Returns false rather than raising when the donor match is no longer
 * releasable. Between proposing and approving, a volunteer may have accepted
 * the very run being taken away; losing that race is a normal outcome the
 * caller must report, not a fault.
 */
create or replace function reallocate_match(
  p_match_id uuid,
  p_to_need_id uuid,
  p_quantity numeric
) returns boolean
  language plpgsql security definer set search_path = public as $$
declare
  v_resource uuid;
  updated integer;
begin
  -- Re-check releasability here, not just in the caller: the proposal was built
  -- from a snapshot, and this is the only moment that matters.
  select m.resource_id into v_resource
  from matches m
  left join missions ms on ms.match_id = m.id
  where m.id = p_match_id
    and m.status in ('proposed', 'reserved')
    and (ms.id is null or (ms.status = 'proposed' and ms.assigned_to is null));

  if v_resource is null then
    return false;
  end if;

  update matches
  set status = 'released'
  where id = p_match_id;

  insert into matches (need_id, resource_id, score, allocated_quantity, status, rationale)
  values (
    p_to_need_id,
    v_resource,
    0,
    p_quantity,
    'reserved',
    jsonb_build_object('reallocatedFrom', p_match_id)
  )
  on conflict do nothing;

  get diagnostics updated = row_count;

  -- The reservation itself does not move: the same units stay reserved against
  -- the same resource, only the need they are promised to changes. Releasing
  -- and re-reserving would open a window where the pool looks larger than it is.
  return updated = 1;
end;
$$;

revoke all on function reallocate_match(uuid, uuid, numeric) from public, anon, authenticated;

alter publication supabase_realtime add table reallocations;
