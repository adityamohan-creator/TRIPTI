-- Crisis report fusion: clusters, and the evidence behind them.
--
-- Strictly additive. Two new tables and nothing else — no existing table is
-- altered, no column dropped, no enum touched or recreated, and `severity`,
-- `extraction_source` and every other existing type are left exactly as they
-- are. This migration can be applied to the live database without changing the
-- behaviour of anything already running.
--
-- Cluster labels are not an enum on purpose. The information-category set is
-- TRIPTI's own and is expected to change as the official TREC-IS taxonomy is
-- mapped in; a Postgres enum would make each of those changes a migration that
-- cannot run inside the same transaction as the code using it. Text with a
-- check constraint would have the same problem. So: plain text, validated in
-- the application where the list actually lives.

create table if not exists report_clusters (
  id uuid primary key default gen_random_uuid(),

  /*
   * The label shown on screen — CL-001 and so on. Stable only within the run
   * that produced it, which is why `id` exists separately and is what anything
   * else references.
   */
  cluster_key text not null,

  /** TRIPTI's own information category. NOT a TREC-IS label. */
  information_category text not null,

  /*
   * AI-03 operational criticality, 0-100. Deliberately NOT the same number as
   * the existing priority engine produces: that one ranks a need against the
   * resource pool, this one ranks an incoming report cluster on what the
   * reports say. Neither derives from the other.
   */
  priority_score numeric not null check (priority_score between 0 and 100),
  priority_level text not null check (priority_level in ('critical', 'high', 'medium', 'low')),

  /** The sentence a coordinator reads. Stored so a decision can be reviewed. */
  priority_reason text,

  /** 'incidents' or 'demo'. Synthetic runs stay distinguishable forever. */
  report_source text not null default 'incidents',

  report_count integer not null default 0 check (report_count >= 0),
  /** Mean similarity of the links that formed the cluster. Null for one report. */
  cohesion numeric,

  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists report_clusters_priority_idx
  on report_clusters (priority_score desc, created_at desc);

alter table report_clusters enable row level security;

drop policy if exists "staff read clusters" on report_clusters;
create policy "staff read clusters" on report_clusters
  for select using (current_user_role() in ('ngo', 'coordinator', 'admin'));

-- ------------------------------------------------------------- evidence

/*
 * The trail from a cluster back to what produced it.
 *
 * `report_id` is nullable and `source_id` is not, which is the shape the data
 * actually has: a demo or externally-sourced report has an identifier but no
 * row in `incidents`, and forcing a foreign key would mean inventing one. An
 * id that does not resolve is worse than an absent one — it turns a checkable
 * claim into an unfalsifiable one, and looks identical to a real id until
 * somebody follows it.
 */
create table if not exists report_evidence (
  id bigserial primary key,

  cluster_id uuid not null references report_clusters (id) on delete cascade,

  /** Set only when the evidence is a real TRIPTI incident. */
  report_id uuid references incidents (id) on delete set null,

  /** Always present. The identifier the report arrived with. Never generated. */
  source_id text not null,

  created_at timestamptz not null default now(),

  -- One cluster cannot cite the same source twice.
  unique (cluster_id, source_id)
);

create index if not exists report_evidence_cluster_idx on report_evidence (cluster_id);
create index if not exists report_evidence_report_idx on report_evidence (report_id);

alter table report_evidence enable row level security;

drop policy if exists "staff read evidence" on report_evidence;
create policy "staff read evidence" on report_evidence
  for select using (current_user_role() in ('ngo', 'coordinator', 'admin'));

-- Live updates for the crisis intelligence screen, same as every other board.
do $$ begin
  alter publication supabase_realtime add table report_clusters;
exception when duplicate_object then null;
end $$;
