-- The lifecycle: consuming stock on delivery, and assigning a volunteer safely.
-- Run AFTER 0008_mission_verified.sql has committed.

-- --------------------------------------------------------- consuming stock

/*
 * Delivery takes stock out of the pool for good.
 *
 * Both columns move together: the reservation is released *and* the quantity
 * drops, because the goods have left. Doing only one is the bug this function
 * exists to make impossible — release alone would hand the same units back out
 * after they were given away, and decrementing alone would leave a reservation
 * against stock that no longer exists.
 *
 * Clamped at zero on both, so a double-delivery is a logged oddity rather than
 * a negative quantity that poisons every later availability calculation.
 */
create or replace function consume_resource(p_resource_id uuid, p_amount numeric)
  returns void
  language plpgsql security definer set search_path = public as $$
begin
  if p_amount is null then return; end if;

  update resources
  set reserved_quantity = greatest(0, reserved_quantity - p_amount),
      quantity = case
        when quantity is null then null
        else greatest(0, quantity - p_amount)
      end
  where id = p_resource_id;
end;
$$;

revoke all on function consume_resource(uuid, numeric) from public, anon, authenticated;

-- ------------------------------------------------------ safe assignment

/*
 * Assigns a volunteer only if they are still under their own limit.
 *
 * The check and the write happen in one statement. Two coordinators looking at
 * the same roster could otherwise both see "0 of 2 missions in hand" and both
 * assign, putting someone on more runs than they said they could take — the
 * same read-then-write race the resource reservation already closes.
 *
 * Returns false when the volunteer is unavailable or full, rather than raising:
 * losing that race is a normal outcome the caller has to report, not a fault.
 */
create or replace function assign_mission(
  p_mission_id uuid,
  p_volunteer_id uuid,
  p_vehicle_id uuid
) returns boolean
  language plpgsql security definer set search_path = public as $$
declare
  updated integer;
begin
  update missions
  set assigned_to = p_volunteer_id,
      vehicle_id = p_vehicle_id
  where id = p_mission_id
    and status not in ('delivered', 'verified', 'failed', 'cancelled')
    and exists (
      select 1
      from volunteers v
      where v.user_id = p_volunteer_id
        and v.availability = 'available'
        and (
          select count(*)
          from missions m
          where m.assigned_to = p_volunteer_id
            and m.status in ('accepted', 'en_route')
            and m.id <> p_mission_id
        ) < v.max_concurrent_missions
    );

  get diagnostics updated = row_count;
  return updated = 1;
end;
$$;

revoke all on function assign_mission(uuid, uuid, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------- indexes

-- The volunteer board and the workload count both filter on this pair.
create index missions_assignee_status_idx on missions (assigned_to, status)
  where assigned_to is not null;

-- Impact is counted from verified missions, so that scan should be cheap.
create index missions_verified_idx on missions (verified_at)
  where status = 'verified';
