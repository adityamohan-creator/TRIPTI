-- Reallocation could not move the stock it was designed to move.
--
-- The engine treats a committed match as releasable while its mission is still
-- 'proposed' with nobody assigned — that is the whole point, since a plan
-- approved minutes ago with no volunteer attached is exactly the safest thing
-- to move. The function only accepted 'proposed' and 'reserved', so every such
-- move was refused. Approving reported "0 of 1 applied" and looked like a
-- successful no-op.
--
-- The refusal was also incomplete in the other direction: moving a committed
-- match leaves its mission behind, still pointing at the old need. A volunteer
-- picking that up would drive to collect a load that had been given away.

create or replace function reallocate_match(
  p_match_id uuid,
  p_to_need_id uuid,
  p_quantity numeric
) returns boolean
  language plpgsql security definer set search_path = public as $$
declare
  v_resource uuid;
  v_mission uuid;
  v_new_match uuid;
begin
  /*
   * Re-check releasability here, not just in the caller.
   *
   * The proposal was built from a snapshot; this is the only moment that
   * matters. A volunteer may have accepted the run in between, and if they
   * have, they win.
   */
  select m.resource_id, ms.id
  into v_resource, v_mission
  from matches m
  left join missions ms on ms.match_id = m.id
  where m.id = p_match_id
    and m.status in ('proposed', 'reserved', 'committed')
    and (
      ms.id is null
      or (ms.status = 'proposed' and ms.assigned_to is null)
    );

  if v_resource is null then
    return false;
  end if;

  -- The mission goes with the match. Cancelling it here rather than through the
  -- normal transition is deliberate: that path releases the reservation, and
  -- the units are not going back to the pool — they are moving to another need
  -- on the same resource. Releasing and re-reserving would open a window where
  -- the pool looks larger than it is.
  if v_mission is not null then
    update missions
    set status = 'cancelled'
    where id = v_mission;

    insert into status_history (entity_type, entity_id, from_status, to_status, note)
    values (
      'mission', v_mission, 'proposed', 'cancelled',
      'Cancelled by a reallocation; its stock moved to a more urgent need.'
    );
  end if;

  update matches set status = 'released' where id = p_match_id;

  insert into matches (need_id, resource_id, score, allocated_quantity, status, rationale)
  values (
    p_to_need_id,
    v_resource,
    0,
    p_quantity,
    'committed',
    jsonb_build_object('reallocatedFrom', p_match_id)
  )
  returning id into v_new_match;

  if v_new_match is null then
    return false;
  end if;

  -- A reservation with no mission is a dead end: the matcher skips needs that
  -- already have a live match, so nothing would ever dispatch it. The receiving
  -- need gets a mission in the same state the donor's was.
  insert into missions (need_id, resource_id, match_id, quantity, status)
  values (p_to_need_id, v_resource, v_new_match, p_quantity, 'proposed');

  return true;
end;
$$;

revoke all on function reallocate_match(uuid, uuid, numeric) from public, anon, authenticated;
