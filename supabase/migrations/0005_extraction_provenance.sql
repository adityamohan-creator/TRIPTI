-- Records how an incident's structured fields were produced.
--
-- Extraction can now degrade to a deterministic keyword scan when the model is
-- unreachable, and a coordinator has to be able to tell the difference at a
-- glance. A fallback result is not a low-confidence extraction — it is a report
-- nothing has read.

create type extraction_source as enum ('model', 'fallback');

alter table incidents
  add column ai_source extraction_source not null default 'model',
  add column ai_provider text,
  add column ai_degraded_reason text,
  -- Children, elderly, disabled, pregnant, injured. Feeds the vulnerability
  -- term of the priority score.
  add column vulnerable_groups jsonb not null default '[]'::jsonb;

comment on column incidents.ai_source is
  'model = an LLM read the report. fallback = keyword scan only, nothing read it.';

create index incidents_ai_source_idx on incidents (ai_source)
  where ai_source = 'fallback';
