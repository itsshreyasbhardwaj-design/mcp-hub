export const migration0001Init = {
  id: '0001_init',
  name: 'Initial schema: identity, registry, governance, observability',
  sql: String.raw`
-- ===========================================================================
-- Identity & tenancy
-- ===========================================================================

create table if not exists organizations (
  id            text primary key,
  external_id   text unique,
  slug          text not null unique,
  name          text not null,
  created_at    timestamptz not null default now()
);

create table if not exists users (
  id            text primary key,
  external_id   text not null unique,
  email         text not null,
  name          text,
  avatar_url    text,
  created_at    timestamptz not null default now()
);
create unique index if not exists users_email_key on users (lower(email));

create table if not exists organization_members (
  id               text primary key,
  organization_id  text not null references organizations(id) on delete cascade,
  user_id          text not null references users(id) on delete cascade,
  role             text not null check (role in ('owner','admin','developer','viewer')),
  created_at       timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index if not exists org_members_user_idx on organization_members (user_id);

create table if not exists teams (
  id               text primary key,
  organization_id  text not null references organizations(id) on delete cascade,
  slug             text not null,
  name             text not null,
  description      text,
  created_at       timestamptz not null default now(),
  unique (organization_id, slug)
);

create table if not exists team_members (
  team_id     text not null references teams(id) on delete cascade,
  user_id     text not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- Dev auth provider sessions. Unused when MCP_HUB_AUTH_PROVIDER=clerk.
create table if not exists auth_sessions (
  id           text primary key,
  token_hash   text not null unique,
  user_id      text not null references users(id) on delete cascade,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now()
);
create index if not exists auth_sessions_expiry_idx on auth_sessions (expires_at);

-- ===========================================================================
-- Registry
-- ===========================================================================

create table if not exists servers (
  id                       text primary key,
  organization_id          text not null references organizations(id) on delete cascade,
  slug                     text not null,
  name                     text not null,
  description              text,
  category                 text,
  tags                     text[] not null default '{}',
  repository_url           text,
  documentation_url        text,
  homepage_url             text,
  license                  text,
  maintainer               text,
  visibility               text not null default 'organization'
                            check (visibility in ('public','organization','private')),
  status                   text not null default 'draft'
                            check (status in ('draft','active','deprecated','archived')),
  latest_version_id        text,
  health_status            text not null default 'unknown'
                            check (health_status in ('healthy','degraded','failing','unknown')),
  health_checked_at        timestamptz,
  health_interval_seconds  integer,
  is_demo                  boolean not null default false,
  created_by               text references users(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (organization_id, slug)
);
create index if not exists servers_org_status_idx on servers (organization_id, status);
create index if not exists servers_org_health_idx on servers (organization_id, health_status);
create index if not exists servers_visibility_idx on servers (visibility) where visibility = 'public';
create index if not exists servers_org_updated_idx on servers (organization_id, updated_at desc, id desc);

create table if not exists server_versions (
  id                   text primary key,
  organization_id      text not null references organizations(id) on delete cascade,
  server_id            text not null references servers(id) on delete cascade,
  version              text not null,
  published            boolean not null default false,
  deprecated           boolean not null default false,
  recommended          boolean not null default false,
  release_notes        text,
  transport            jsonb not null,
  environment          jsonb not null default '[]'::jsonb,
  supported_platforms  text[] not null default '{}',
  capabilities         jsonb,
  protocol_version     text,
  server_info          jsonb,
  discovered_at        timestamptz,
  published_at         timestamptz,
  created_by           text references users(id) on delete set null,
  created_at           timestamptz not null default now(),
  unique (server_id, version)
);
create index if not exists server_versions_server_idx on server_versions (server_id, created_at desc);
create index if not exists server_versions_org_idx on server_versions (organization_id);

alter table servers drop constraint if exists servers_latest_version_fk;
alter table servers add constraint servers_latest_version_fk
  foreign key (latest_version_id) references server_versions(id) on delete set null;

create table if not exists server_tools (
  id                    text primary key,
  organization_id       text not null references organizations(id) on delete cascade,
  server_id             text not null references servers(id) on delete cascade,
  version_id            text not null references server_versions(id) on delete cascade,
  name                  text not null,
  title                 text,
  description           text,
  input_schema          jsonb not null,
  output_schema         jsonb,
  annotations           jsonb,
  risk_class            text not null default 'UNKNOWN'
                         check (risk_class in ('READ','WRITE','NETWORK','CREDENTIAL','DESTRUCTIVE','ADMIN','UNKNOWN')),
  risk_reason           text not null default '',
  risk_override         text check (risk_override in ('READ','WRITE','NETWORK','CREDENTIAL','DESTRUCTIVE','ADMIN','UNKNOWN')),
  risk_override_by      text references users(id) on delete set null,
  risk_override_reason  text,
  risk_override_at      timestamptz,
  schema_fingerprint    text not null,
  created_at            timestamptz not null default now(),
  unique (version_id, name)
);
create index if not exists server_tools_name_idx on server_tools (name);
create index if not exists server_tools_org_name_idx on server_tools (organization_id, name);
create index if not exists server_tools_server_idx on server_tools (server_id);
create index if not exists server_tools_risk_idx on server_tools (organization_id, risk_class);

create table if not exists server_resources (
  id               text primary key,
  organization_id  text not null references organizations(id) on delete cascade,
  server_id        text not null references servers(id) on delete cascade,
  version_id       text not null references server_versions(id) on delete cascade,
  uri              text not null,
  name             text,
  description      text,
  mime_type        text,
  is_template      boolean not null default false,
  created_at       timestamptz not null default now(),
  unique (version_id, uri)
);
create index if not exists server_resources_server_idx on server_resources (server_id);

create table if not exists server_prompts (
  id               text primary key,
  organization_id  text not null references organizations(id) on delete cascade,
  server_id        text not null references servers(id) on delete cascade,
  version_id       text not null references server_versions(id) on delete cascade,
  name             text not null,
  description      text,
  arguments        jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now(),
  unique (version_id, name)
);
create index if not exists server_prompts_server_idx on server_prompts (server_id);

create table if not exists server_environments (
  id                  text primary key,
  organization_id     text not null references organizations(id) on delete cascade,
  server_id           text not null references servers(id) on delete cascade,
  name                text not null,
  description         text,
  transport_override  jsonb,
  secret_refs         jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (server_id, name)
);

-- Envelope-encrypted credential material. Ciphertext only; never selected
-- by list endpoints and never serialised to the browser.
create table if not exists server_secrets (
  id               text primary key,
  organization_id  text not null references organizations(id) on delete cascade,
  server_id        text not null references servers(id) on delete cascade,
  environment_id   text references server_environments(id) on delete cascade,
  key              text not null,
  ciphertext       text not null,
  iv               text not null,
  auth_tag         text not null,
  created_by       text references users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists server_secrets_scope_idx
  on server_secrets (server_id, coalesce(environment_id, ''), key);

-- ===========================================================================
-- Validation, testing, health
-- ===========================================================================

create table if not exists validation_runs (
  id               text primary key,
  organization_id  text not null references organizations(id) on delete cascade,
  server_id        text not null references servers(id) on delete cascade,
  version_id       text references server_versions(id) on delete cascade,
  outcome          text not null check (outcome in ('pass','warning','error')),
  error_count      integer not null default 0,
  warning_count    integer not null default 0,
  info_count       integer not null default 0,
  duration_ms      integer not null default 0,
  triggered_by     text references users(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists validation_runs_server_idx on validation_runs (server_id, created_at desc);
create index if not exists validation_runs_org_idx on validation_runs (organization_id, created_at desc);

create table if not exists validation_findings (
  id           text primary key,
  run_id       text not null references validation_runs(id) on delete cascade,
  severity     text not null check (severity in ('error','warning','info')),
  rule         text not null,
  location     text not null,
  message      text not null,
  suggestion   text,
  ordinal      integer not null default 0
);
create index if not exists validation_findings_run_idx on validation_findings (run_id, ordinal);
create index if not exists validation_findings_rule_idx on validation_findings (rule);

create table if not exists compatibility_runs (
  id               text primary key,
  organization_id  text not null references organizations(id) on delete cascade,
  server_id        text not null references servers(id) on delete cascade,
  version_id       text not null references server_versions(id) on delete cascade,
  environment_id   text references server_environments(id) on delete set null,
  suites           text[] not null default '{}',
  total            integer not null default 0,
  passed           integer not null default 0,
  warnings         integer not null default 0,
  failed           integer not null default 0,
  skipped          integer not null default 0,
  duration_ms      integer not null default 0,
  triggered_by     text references users(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists compatibility_runs_server_idx on compatibility_runs (server_id, created_at desc);

create table if not exists compatibility_cases (
  id           text primary key,
  run_id       text not null references compatibility_runs(id) on delete cascade,
  suite        text not null,
  key          text not null,
  title        text not null,
  outcome      text not null check (outcome in ('passed','warning','failed','skipped')),
  duration_ms  integer not null default 0,
  message      text,
  evidence     jsonb,
  ordinal      integer not null default 0
);
create index if not exists compatibility_cases_run_idx on compatibility_cases (run_id, ordinal);

create table if not exists health_checks (
  id               text primary key,
  organization_id  text not null references organizations(id) on delete cascade,
  server_id        text not null references servers(id) on delete cascade,
  version_id       text references server_versions(id) on delete set null,
  status           text not null check (status in ('healthy','degraded','failing','unknown')),
  latency_ms       integer,
  tool_count       integer,
  initialized      boolean not null default false,
  timed_out        boolean not null default false,
  error_code       text,
  error_message    text,
  checked_at       timestamptz not null default now()
);
create index if not exists health_checks_server_time_idx on health_checks (server_id, checked_at desc);
create index if not exists health_checks_org_time_idx on health_checks (organization_id, checked_at desc);

create table if not exists incidents (
  id               text primary key,
  organization_id  text not null references organizations(id) on delete cascade,
  server_id        text not null references servers(id) on delete cascade,
  kind             text not null,
  status           text not null check (status in ('investigating','ongoing','resolved')),
  title            text not null,
  evidence         jsonb not null default '[]'::jsonb,
  started_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  updated_at       timestamptz not null default now()
);
create index if not exists incidents_org_status_idx on incidents (organization_id, status, started_at desc);
create unique index if not exists incidents_open_unique_idx
  on incidents (server_id, kind) where status <> 'resolved';

-- ===========================================================================
-- Permissions, approvals, invocations
-- ===========================================================================

create table if not exists permission_rules (
  id               text primary key,
  organization_id  text not null references organizations(id) on delete cascade,
  effect           text not null check (effect in ('allow','require_approval','deny')),
  subject_user_id  text references users(id) on delete cascade,
  subject_role     text,
  server_id        text references servers(id) on delete cascade,
  version_id       text references server_versions(id) on delete cascade,
  tool_name        text,
  risk_class       text,
  environment_id   text references server_environments(id) on delete cascade,
  priority         integer not null default 0,
  description      text,
  created_by       text references users(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists permission_rules_org_idx on permission_rules (organization_id, priority desc);

create table if not exists approvals (
  id               text primary key,
  organization_id  text not null references organizations(id) on delete cascade,
  server_id        text not null references servers(id) on delete cascade,
  version_id       text not null references server_versions(id) on delete cascade,
  tool_name        text not null,
  risk_class       text not null,
  arguments_json   jsonb not null,
  arguments_hash   text not null,
  reason           text,
  status           text not null check (status in ('pending','approved','denied','expired','consumed')),
  requested_by     text not null references users(id) on delete cascade,
  decided_by       text references users(id) on delete set null,
  decision_reason  text,
  decided_at       timestamptz,
  expires_at       timestamptz not null,
  consumed_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists approvals_org_status_idx on approvals (organization_id, status, created_at desc);
create index if not exists approvals_lookup_idx on approvals (organization_id, version_id, tool_name, arguments_hash, status);

create table if not exists tool_invocations (
  id               text primary key,
  organization_id  text not null references organizations(id) on delete cascade,
  server_id        text not null references servers(id) on delete cascade,
  version_id       text not null references server_versions(id) on delete cascade,
  environment_id   text references server_environments(id) on delete set null,
  tool_name        text not null,
  risk_class       text not null,
  status           text not null check (status in ('success','error','timeout','denied','blocked')),
  duration_ms      integer not null default 0,
  error_code       text,
  error_message    text,
  request_bytes    integer not null default 0,
  response_bytes   integer not null default 0,
  approval_id      text references approvals(id) on delete set null,
  actor_user_id    text references users(id) on delete set null,
  actor_api_key_id text,
  request_id       text not null,
  created_at       timestamptz not null default now()
);
create index if not exists invocations_org_time_idx on tool_invocations (organization_id, created_at desc);
create index if not exists invocations_server_time_idx on tool_invocations (server_id, created_at desc);
create index if not exists invocations_tool_idx on tool_invocations (organization_id, server_id, tool_name, created_at desc);
create index if not exists invocations_status_idx on tool_invocations (organization_id, status, created_at desc);

-- ===========================================================================
-- Audit, API keys, security findings
-- ===========================================================================

create table if not exists audit_logs (
  id               text primary key,
  organization_id  text not null references organizations(id) on delete cascade,
  actor_type       text not null check (actor_type in ('user','api_key','system')),
  actor_id         text,
  actor_label      text not null,
  action           text not null,
  resource_type    text not null,
  resource_id      text,
  result           text not null check (result in ('allowed','denied','error')),
  request_id       text not null,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists audit_logs_org_time_idx on audit_logs (organization_id, created_at desc, id desc);
create index if not exists audit_logs_resource_idx on audit_logs (organization_id, resource_type, resource_id);
create index if not exists audit_logs_actor_idx on audit_logs (organization_id, actor_id, created_at desc);

create table if not exists api_keys (
  id               text primary key,
  organization_id  text not null references organizations(id) on delete cascade,
  name             text not null,
  prefix           text not null,
  hash             text not null unique,
  scopes           text[] not null default '{}',
  created_by       text references users(id) on delete set null,
  last_used_at     timestamptz,
  expires_at       timestamptz,
  revoked_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists api_keys_org_idx on api_keys (organization_id, created_at desc);
create index if not exists api_keys_prefix_idx on api_keys (prefix);

create table if not exists security_findings (
  id               text primary key,
  organization_id  text not null references organizations(id) on delete cascade,
  server_id        text not null references servers(id) on delete cascade,
  version_id       text references server_versions(id) on delete cascade,
  severity         text not null check (severity in ('error','warning','info')),
  rule             text not null,
  title            text not null,
  detail           text not null,
  excerpt          text,
  location         text not null,
  acknowledged_by  text references users(id) on delete set null,
  acknowledged_at  timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists security_findings_org_idx on security_findings (organization_id, severity, created_at desc);
create index if not exists security_findings_server_idx on security_findings (server_id);
create unique index if not exists security_findings_dedupe_idx
  on security_findings (server_id, coalesce(version_id, ''), rule, location);

-- ===========================================================================
-- Analytics
-- ===========================================================================

create table if not exists analytics_events (
  id               text primary key,
  organization_id  text not null references organizations(id) on delete cascade,
  type             text not null,
  server_id        text references servers(id) on delete cascade,
  version_id       text references server_versions(id) on delete cascade,
  tool_name        text,
  environment_id   text references server_environments(id) on delete set null,
  actor_user_id    text references users(id) on delete set null,
  value            double precision,
  status           text,
  metadata         jsonb not null default '{}'::jsonb,
  occurred_at      timestamptz not null default now()
);
create index if not exists analytics_events_org_time_idx on analytics_events (organization_id, occurred_at desc);
create index if not exists analytics_events_type_idx on analytics_events (organization_id, type, occurred_at desc);
create index if not exists analytics_events_server_idx on analytics_events (server_id, occurred_at desc);

create table if not exists metric_snapshots (
  id               text primary key,
  organization_id  text not null references organizations(id) on delete cascade,
  server_id        text references servers(id) on delete cascade,
  metric           text not null,
  window_label     text not null,
  value            double precision not null,
  captured_at      timestamptz not null default now()
);
create index if not exists metric_snapshots_lookup_idx
  on metric_snapshots (organization_id, metric, window_label, captured_at desc);

-- ===========================================================================
-- Search index
-- ===========================================================================

create table if not exists search_documents (
  id               text primary key,
  organization_id  text not null references organizations(id) on delete cascade,
  doc_type         text not null check (doc_type in ('server','tool','resource','prompt')),
  entity_id        text not null,
  server_id        text not null references servers(id) on delete cascade,
  version_id       text references server_versions(id) on delete cascade,
  visibility       text not null,
  title            text not null,
  subtitle         text,
  body             text not null default '',
  tags             text[] not null default '{}',
  risk_class       text,
  tsv              tsvector,
  updated_at       timestamptz not null default now(),
  unique (doc_type, entity_id)
);
create index if not exists search_documents_tsv_idx on search_documents using gin (tsv);
create index if not exists search_documents_org_type_idx on search_documents (organization_id, doc_type);
create index if not exists search_documents_title_prefix_idx on search_documents (lower(title) text_pattern_ops);
create index if not exists search_documents_server_idx on search_documents (server_id);

-- ===========================================================================
-- Durable job queue
-- ===========================================================================

create table if not exists jobs (
  id               text primary key,
  organization_id  text references organizations(id) on delete cascade,
  kind             text not null,
  payload          jsonb not null default '{}'::jsonb,
  status           text not null default 'pending'
                    check (status in ('pending','running','succeeded','failed','cancelled')),
  priority         integer not null default 0,
  attempts         integer not null default 0,
  max_attempts     integer not null default 3,
  run_at           timestamptz not null default now(),
  locked_at        timestamptz,
  locked_by        text,
  lock_expires_at  timestamptz,
  last_error       text,
  /* Set on recurring jobs so a rescheduled run can replace the previous one. */
  dedupe_key       text,
  result           jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists jobs_claim_idx on jobs (status, run_at, priority desc);
create index if not exists jobs_org_idx on jobs (organization_id, created_at desc);
create unique index if not exists jobs_dedupe_idx on jobs (dedupe_key) where dedupe_key is not null and status in ('pending','running');
`,
};
