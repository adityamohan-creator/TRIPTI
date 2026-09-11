-- Impact reporting reads the operational records, not `impact_metrics`.
--
-- The table has sat empty since 0004 created it, and an empty table with
-- exactly the right column names is a trap: the obvious way to build an impact
-- dashboard is to select from it, and the dashboard would render all zeroes
-- with nothing to indicate anything was wrong.
--
-- Totals are derived from verified missions joined to their needs, incidents
-- and resources, so a correction to a mission is reflected the next time anyone
-- looks. An accumulated counter cannot do that — it keeps the figure it was
-- given and offers no way to tell that it is stale.
--
-- The table is kept rather than dropped because a period snapshot is a real
-- future need: once a response closes, freezing its figures against the records
-- as they stood is worth doing. Nothing writes it today.

comment on table impact_metrics is
  'Reserved for frozen period snapshots. NOT the source for live impact figures — '
  'those are derived from verified missions (see backend/src/services/impact.service.ts). '
  'Empty by design; do not read it for a dashboard.';

-- ------------------------------------------------- reporting support

/*
 * Impact is counted from verified deliveries, and finding them means scanning
 * the trail for one entity type and one status. Without this the report reads
 * the whole history table, which only grows.
 */
create index if not exists status_history_verified_idx
  on status_history (entity_type, to_status, changed_at)
  where entity_type = 'mission' and to_status = 'verified';

create index if not exists missions_verified_idx
  on missions (status)
  where status = 'verified';
