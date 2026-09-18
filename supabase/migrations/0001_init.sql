-- =============================================================================
-- LegacyVault AI — 0001_init.sql (task T018)
-- Schema of record: specs/001-baseline-product-spec/data-model.md (r4).
-- 29 entities = 28 tables (Session is externalized to Clerk, ADR-003).
-- This migration contains ONLY types, tables, constraints, indexes and the
-- updated_at maintenance trigger. Privileges/RLS live in 0002, guarded and
-- system functions in 0003 (ADR-002, ADR-004 r4).
-- Column names are snake_case; the data model shows them in camelCase.
-- =============================================================================
-- The Supabase CLI applies each migration file in its own transaction.

-- -----------------------------------------------------------------------------
-- Enumerated types
-- -----------------------------------------------------------------------------
create type public.user_role as enum ('USER', 'SUPER_ADMIN');
create type public.beneficiary_status as enum ('PENDING', 'ACTIVE', 'INACTIVE');
create type public.financial_asset_category as enum
  ('BANK_ACCOUNT', 'FIXED_DEPOSIT', 'MUTUAL_FUND', 'STOCK', 'INSURANCE', 'RETIREMENT');
create type public.physical_asset_category as enum
  ('REAL_ESTATE', 'VEHICLE', 'GOLD_JEWELRY', 'PERSONAL_PROPERTY', 'BUSINESS_ASSET');
create type public.digital_asset_category as enum
  ('CRYPTO_WALLET', 'ONLINE_ACCOUNT', 'DOMAIN', 'SUBSCRIPTION', 'SOCIAL_MEDIA', 'OTHER');
create type public.encryption_mode as enum ('PROVIDER_SSE', 'APP_ENVELOPE');
create type public.scan_status as enum ('PENDING', 'CLEAN', 'INFECTED', 'ERROR');
create type public.legacy_plan_status as enum ('DRAFT', 'FINALIZED');
create type public.delivery_condition as enum ('IMMEDIATE', 'DEAD_MAN_SWITCH', 'EMERGENCY_ACCESS');
create type public.dms_status as enum
  ('INACTIVE', 'ACTIVE', 'REMINDER_SENT', 'GRACE_PERIOD', 'ESCALATING', 'RELEASING', 'RELEASED', 'PAUSED');
create type public.dms_event_type as enum
  ('CHECK_IN', 'MISSED_CHECK_IN', 'ESCALATION_STEP', 'RECOVERY', 'RELEASE', 'PAUSE', 'RESUME', 'CONFIG_CHANGE');
create type public.ea_verification_method as enum ('EMAIL_OTP');
create type public.ea_on_timeout as enum ('WAIT', 'AUTO_GRANT', 'DENY');
create type public.ea_config_status as enum ('ACTIVE', 'INACTIVE');
create type public.ea_request_status as enum
  ('PENDING', 'VERIFYING', 'VERIFIED', 'FAILED', 'APPROVED', 'DENIED', 'AUTO_GRANTED', 'EXPIRED', 'ACTIVE', 'REVOKED');
create type public.ea_decided_by as enum ('OWNER', 'SYSTEM');
create type public.ea_revoked_by as enum ('OWNER', 'SYSTEM', 'EXPIRY');
create type public.assignment_resource_type as enum
  ('FINANCIAL_ASSET', 'PHYSICAL_ASSET', 'DIGITAL_ASSET', 'DOCUMENT', 'VIDEO_MESSAGE');
create type public.attachment_resource_type as enum
  ('FINANCIAL_ASSET', 'PHYSICAL_ASSET', 'DIGITAL_ASSET', 'LEGACY_PLAN');
create type public.audit_outcome as enum ('SUCCESS', 'FAILURE', 'DENIED');
create type public.ai_session_type as enum ('ASSISTANT', 'WILL_GENERATOR', 'DOCUMENT_ANALYSIS');
create type public.notification_channel as enum ('EMAIL', 'IN_APP', 'BOTH');
create type public.notification_delivery_status as enum ('PENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED');
create type public.access_grant_type as enum ('DIRECT_SHARE', 'DMS_RELEASE', 'EMERGENCY_ACCESS');
create type public.token_revoked_reason as enum
  ('OWNER', 'BENEFICIARY_INACTIVE', 'BENEFICIARY_REMOVED', 'RECOVERY', 'EXPIRED', 'UNDELIVERED_REPLACED', 'RESENT', 'ADMIN');
create type public.job_status as enum ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD');
create type public.upload_kind as enum ('DOCUMENT', 'DOCUMENT_VERSION', 'VIDEO');
create type public.upload_status as enum
  ('PENDING', 'UPLOADED', 'VALIDATING', 'SCANNING', 'SCANNED_CLEAN', 'PROMOTED', 'REJECTED', 'EXPIRED');
create type public.ai_draft_kind as enum ('WILL_DRAFT', 'DOCUMENT_ANALYSIS');
create type public.ai_draft_status as enum ('DRAFT', 'PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED', 'SUPERSEDED');
create type public.ai_version_author as enum ('AI', 'USER');
create type public.webhook_provider as enum ('CLERK', 'EMAIL');

-- -----------------------------------------------------------------------------
-- updated_at maintenance (plain trigger function, no privileges implied)
-- -----------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- =============================================================================
-- 1. users — Class A (plain columns) + B (set_encrypted_fields). Credentials,
--    passwords, MFA secrets and lockout counters belong to Clerk (ADR-003).
-- =============================================================================
create table public.users (
  id                        uuid primary key default gen_random_uuid(),
  clerk_user_id             text not null unique,
  email                     text not null unique check (email = lower(email)),
  email_verified            boolean not null default false,
  name                      text not null,
  mfa_enabled               boolean not null default false,
  date_of_birth             date,
  phone                     text,
  alternate_email           text check (alternate_email is null or alternate_email = lower(alternate_email)),
  address                   jsonb,
  identification_details    text,                     -- ENCRYPTED envelope; function-only write
  family_info               jsonb,
  role                      public.user_role not null default 'USER',
  preferences               jsonb default '{}'::jsonb,
  notification_preferences  jsonb default '{}'::jsonb,
  security_preferences      jsonb default '{}'::jsonb,
  onboarding_completed_at   timestamptz,
  last_login_at             timestamptz,
  deletion_requested_at     timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz
);
create index users_role_idx on public.users (role);
create index users_deletion_requested_at_idx on public.users (deletion_requested_at) where deletion_requested_at is not null;
create index users_deleted_at_idx on public.users (deleted_at);
create trigger users_set_updated_at before update on public.users
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 2. beneficiaries — Class A (contact fields) + B (status / removal)
-- =============================================================================
create table public.beneficiaries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  name          text not null,
  relationship  text not null,
  email         text not null check (email = lower(email)),
  phone         text,
  status        public.beneficiary_status not null default 'PENDING',
  invited_at    timestamptz,
  activated_at  timestamptz,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create unique index beneficiaries_user_email_live_uidx on public.beneficiaries (user_id, email) where deleted_at is null;
create index beneficiaries_user_id_idx on public.beneficiaries (user_id);
create index beneficiaries_status_idx on public.beneficiaries (status);
create trigger beneficiaries_set_updated_at before update on public.beneficiaries
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 3–5. assets — Class A (plain-column UPDATE) + B (create_asset / set_encrypted_fields / delete_asset)
-- =============================================================================
create table public.financial_assets (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users (id) on delete cascade,
  name             text not null,
  category         public.financial_asset_category not null,
  institution      text,
  account_number   text,                                -- ENCRYPTED envelope; function-only write
  policy_number    text,                                -- ENCRYPTED envelope; function-only write
  estimated_value  numeric(18, 2) check (estimated_value is null or estimated_value >= 0),
  currency         char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  notes            text,
  metadata         jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index financial_assets_user_id_idx on public.financial_assets (user_id);
create index financial_assets_category_idx on public.financial_assets (category);
create index financial_assets_deleted_at_idx on public.financial_assets (deleted_at);
create trigger financial_assets_set_updated_at before update on public.financial_assets
  for each row execute function public.set_updated_at();

create table public.physical_assets (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users (id) on delete cascade,
  name               text not null,
  category           public.physical_asset_category not null,
  description        text,
  location           text,
  estimated_value    numeric(18, 2) check (estimated_value is null or estimated_value >= 0),
  currency           char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  ownership_details  text,
  notes              text,
  metadata           jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create index physical_assets_user_id_idx on public.physical_assets (user_id);
create index physical_assets_category_idx on public.physical_assets (category);
create index physical_assets_deleted_at_idx on public.physical_assets (deleted_at);
create trigger physical_assets_set_updated_at before update on public.physical_assets
  for each row execute function public.set_updated_at();

create table public.digital_assets (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users (id) on delete cascade,
  name             text not null,
  category         public.digital_asset_category not null,
  platform         text,
  username         text,
  credentials      text,                                -- ENCRYPTED envelope; function-only write
  recovery_info    text,                                -- ENCRYPTED envelope; function-only write
  estimated_value  numeric(18, 2) check (estimated_value is null or estimated_value >= 0),
  currency         char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  notes            text,
  metadata         jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index digital_assets_user_id_idx on public.digital_assets (user_id);
create index digital_assets_category_idx on public.digital_assets (category);
create index digital_assets_deleted_at_idx on public.digital_assets (deleted_at);
create trigger digital_assets_set_updated_at before update on public.digital_assets
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 8. folders — Class A
-- =============================================================================
create table public.folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  parent_id   uuid references public.folders (id) on delete set null,
  name        text not null check (length(name) between 1 and 255),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint folders_no_self_parent check (parent_id is null or parent_id <> id)
);
create unique index folders_user_parent_name_live_uidx on public.folders (user_id, parent_id, name) nulls not distinct where deleted_at is null;
create index folders_user_id_idx on public.folders (user_id);
create index folders_parent_id_idx on public.folders (parent_id);
create trigger folders_set_updated_at before update on public.folders
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 6–7. documents / document_versions — Class A (metadata) + B/C (lifecycle)
--      documents rows are created only by promote_upload(); the FK to the
--      current version is added after document_versions exists (cycle).
-- =============================================================================
create table public.documents (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users (id) on delete cascade,
  folder_id           uuid references public.folders (id) on delete set null,
  name                text not null,
  mime_type           text not null,
  size_bytes          bigint not null check (size_bytes > 0 and size_bytes <= 52428800), -- 50 MB (FR-H002)
  storage_bucket      text not null default 'documents',
  storage_key         text not null,
  encryption_mode     public.encryption_mode not null default 'PROVIDER_SSE',
  encryption_key_id   text,
  scan_status         public.scan_status not null default 'PENDING',
  current_version_id  uuid,
  metadata            jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  constraint documents_encryption_key_mode check (encryption_mode = 'APP_ENVELOPE' or encryption_key_id is null)
);
create index documents_user_id_idx on public.documents (user_id);
create index documents_folder_id_idx on public.documents (folder_id);
create index documents_deleted_at_idx on public.documents (deleted_at);
create trigger documents_set_updated_at before update on public.documents
  for each row execute function public.set_updated_at();

create table public.document_versions (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references public.documents (id) on delete cascade,
  version_number  integer not null check (version_number >= 1),
  storage_key     text not null,
  size_bytes      bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  uploaded_by     uuid not null references public.users (id),
  created_at      timestamptz not null default now(),
  unique (document_id, version_number)
);
create index document_versions_uploaded_by_idx on public.document_versions (uploaded_by);

alter table public.documents
  add constraint documents_current_version_fk
  foreign key (current_version_id) references public.document_versions (id) on delete set null;
create index documents_current_version_id_idx on public.documents (current_version_id);

-- =============================================================================
-- 9–10. legacy_plans / legacy_plan_versions — Class B
-- =============================================================================
create table public.legacy_plans (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users (id) on delete cascade,
  status             public.legacy_plan_status not null default 'DRAFT',
  current_step       integer not null default 1 check (current_step between 1 and 11),
  steps_data         jsonb not null default '{}'::jsonb,
  completion_status  jsonb not null default '{}'::jsonb,
  version            integer not null default 1 check (version >= 1),
  finalized_at       timestamptz,
  confirmed_by       uuid references public.users (id) on delete set null,
  lock_version       integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  constraint legacy_plans_finalized_consistency check (
    (status = 'FINALIZED') = (finalized_at is not null)
  )
);
create unique index legacy_plans_one_draft_per_user_uidx on public.legacy_plans (user_id) where status = 'DRAFT';
create index legacy_plans_user_id_idx on public.legacy_plans (user_id);
create index legacy_plans_confirmed_by_idx on public.legacy_plans (confirmed_by);
create trigger legacy_plans_set_updated_at before update on public.legacy_plans
  for each row execute function public.set_updated_at();

create table public.legacy_plan_versions (
  id                       uuid primary key default gen_random_uuid(),
  legacy_plan_id           uuid not null references public.legacy_plans (id) on delete cascade,
  version_number           integer not null check (version_number >= 1),
  snapshot_data            jsonb not null,
  completeness             jsonb not null,
  acknowledged_incomplete  boolean not null default false,
  incomplete_sections      text[] not null default '{}',
  finalized_at             timestamptz not null,
  created_at               timestamptz not null default now(),
  unique (legacy_plan_id, version_number)
);

-- =============================================================================
-- 11. video_messages — Class A (metadata columns) + B/C (lifecycle)
-- =============================================================================
create table public.video_messages (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users (id) on delete cascade,
  title               text not null,
  description         text,
  storage_bucket      text not null default 'videos',
  storage_key         text not null,
  encryption_mode     public.encryption_mode not null default 'PROVIDER_SSE',
  encryption_key_id   text,
  scan_status         public.scan_status not null default 'PENDING',
  mime_type           text not null,
  size_bytes          bigint not null check (size_bytes > 0 and size_bytes <= 524288000), -- 500 MB (FR-K002)
  delivery_condition  public.delivery_condition not null,
  metadata            jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  constraint video_messages_encryption_key_mode check (encryption_mode = 'APP_ENVELOPE' or encryption_key_id is null)
);
create index video_messages_user_id_idx on public.video_messages (user_id);
create index video_messages_delivery_condition_idx on public.video_messages (delivery_condition);
create index video_messages_deleted_at_idx on public.video_messages (deleted_at);
create trigger video_messages_set_updated_at before update on public.video_messages
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 12–13. dead_man_switches / dead_man_switch_events — Class B / B+C
-- =============================================================================
create table public.dead_man_switches (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null unique references public.users (id) on delete cascade,
  status                   public.dms_status not null default 'INACTIVE',
  inactivity_period_days   integer not null check (inactivity_period_days between 7 and 365),
  check_in_frequency_days  integer not null check (check_in_frequency_days between 1 and 90),
  escalation_delay_hours   integer not null default 24 check (escalation_delay_hours between 1 and 168),
  release_scope            jsonb not null default '{}'::jsonb,
  escalation_rules         jsonb not null default '{}'::jsonb,
  last_check_in_at         timestamptz,
  next_check_in_at         timestamptz,
  current_escalation_step  integer not null default 0 check (current_escalation_step >= 0),
  paused_at                timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index dead_man_switches_status_idx on public.dead_man_switches (status);
create index dead_man_switches_next_check_in_at_idx on public.dead_man_switches (next_check_in_at);
create trigger dead_man_switches_set_updated_at before update on public.dead_man_switches
  for each row execute function public.set_updated_at();

create table public.dead_man_switch_events (
  id                  uuid primary key default gen_random_uuid(),
  dead_man_switch_id  uuid not null references public.dead_man_switches (id) on delete cascade,
  event_type          public.dms_event_type not null,
  previous_state      text not null,
  new_state           text not null,
  metadata            jsonb,
  created_at          timestamptz not null default now()
);
create index dead_man_switch_events_switch_id_idx on public.dead_man_switch_events (dead_man_switch_id);
create index dead_man_switch_events_event_type_idx on public.dead_man_switch_events (event_type);
create index dead_man_switch_events_created_at_idx on public.dead_man_switch_events (created_at);

-- =============================================================================
-- 25. dead_man_switch_contacts — Class B (written only by dms_configure)
-- =============================================================================
create table public.dead_man_switch_contacts (
  dead_man_switch_id  uuid not null references public.dead_man_switches (id) on delete cascade,
  beneficiary_id      uuid not null references public.beneficiaries (id) on delete cascade,
  notify_order        integer not null default 1 check (notify_order >= 1),
  created_at          timestamptz not null default now(),
  primary key (dead_man_switch_id, beneficiary_id)
);
create index dead_man_switch_contacts_beneficiary_id_idx on public.dead_man_switch_contacts (beneficiary_id);

-- =============================================================================
-- 14–15. emergency_access_configs / emergency_access_requests — Class B (+C flows)
--        The FK from requests to access_tokens is added after access_tokens (cycle).
-- =============================================================================
create table public.emergency_access_configs (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references public.users (id) on delete cascade,
  beneficiary_id             uuid not null references public.beneficiaries (id) on delete cascade,
  access_scope               jsonb not null,
  verification_method        public.ea_verification_method not null default 'EMAIL_OTP',
  on_timeout                 public.ea_on_timeout not null default 'WAIT',
  timeout_hours              integer check (timeout_hours is null or timeout_hours between 1 and 168),
  request_expiry_hours       integer not null default 72 check (request_expiry_hours between 1 and 720),
  access_duration_hours      integer not null default 72 check (access_duration_hours between 1 and 720),
  status                     public.ea_config_status not null default 'ACTIVE',
  last_designation_sent_at   timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  deleted_at                 timestamptz,
  constraint ea_configs_timeout_required check (on_timeout = 'WAIT' or timeout_hours is not null)
);
create unique index ea_configs_user_beneficiary_live_uidx on public.emergency_access_configs (user_id, beneficiary_id) where deleted_at is null;
create index ea_configs_user_id_idx on public.emergency_access_configs (user_id);
create index ea_configs_beneficiary_id_idx on public.emergency_access_configs (beneficiary_id);
create index ea_configs_status_idx on public.emergency_access_configs (status);
create trigger ea_configs_set_updated_at before update on public.emergency_access_configs
  for each row execute function public.set_updated_at();

create table public.emergency_access_requests (
  id                     uuid primary key default gen_random_uuid(),
  config_id              uuid not null references public.emergency_access_configs (id) on delete cascade,
  requester_email        text not null check (requester_email = lower(requester_email)),
  status                 public.ea_request_status not null default 'PENDING',
  otp_hash               text,                          -- hash only, never the code
  otp_expires_at         timestamptz,
  verification_attempts  integer not null default 0 check (verification_attempts between 0 and 3),
  request_expires_at     timestamptz not null,
  decided_by             public.ea_decided_by,
  decided_at             timestamptz,
  access_token_id        uuid,
  granted_at             timestamptz,
  expires_at             timestamptz,
  revoked_at             timestamptz,
  revoked_by             public.ea_revoked_by,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index ea_requests_config_id_idx on public.emergency_access_requests (config_id);
create index ea_requests_status_idx on public.emergency_access_requests (status);
create index ea_requests_request_expires_at_idx on public.emergency_access_requests (request_expires_at);
create index ea_requests_expires_at_idx on public.emergency_access_requests (expires_at);
create trigger ea_requests_set_updated_at before update on public.emergency_access_requests
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 21. access_tokens — Class B (issue/revoke) / C (system grants). Hash only.
-- =============================================================================
create table public.access_tokens (
  id                            uuid primary key default gen_random_uuid(),
  owner_user_id                 uuid not null references public.users (id) on delete cascade,
  beneficiary_id                uuid not null references public.beneficiaries (id) on delete cascade,
  grant_type                    public.access_grant_type not null,
  dead_man_switch_id            uuid references public.dead_man_switches (id) on delete cascade,
  emergency_request_id          uuid references public.emergency_access_requests (id) on delete cascade,
  token_hash                    text not null unique,
  scope                         jsonb not null,
  expires_at                    timestamptz not null,
  revoked_at                    timestamptz,
  revoked_reason                public.token_revoked_reason,
  delivered_at                  timestamptz,
  delivery_provider_message_id  text,
  replaces_token_id             uuid references public.access_tokens (id) on delete set null,
  used_at                       timestamptz,
  last_used_at                  timestamptz,
  created_at                    timestamptz not null default now(),
  constraint access_tokens_dms_link check ((grant_type = 'DMS_RELEASE') = (dead_man_switch_id is not null)),
  constraint access_tokens_ea_link check ((grant_type = 'EMERGENCY_ACCESS') = (emergency_request_id is not null)),
  constraint access_tokens_revoked_reason check ((revoked_at is null) = (revoked_reason is null))
);
create index access_tokens_beneficiary_id_idx on public.access_tokens (beneficiary_id);
create index access_tokens_owner_user_id_idx on public.access_tokens (owner_user_id);
create index access_tokens_expires_at_idx on public.access_tokens (expires_at);
create index access_tokens_replaces_token_id_idx on public.access_tokens (replaces_token_id);
create index access_tokens_dead_man_switch_id_idx on public.access_tokens (dead_man_switch_id);
create index access_tokens_emergency_request_id_idx on public.access_tokens (emergency_request_id);
-- At most one live system-issued token per (switch, beneficiary) and per emergency request (ADR-014 § 6).
create unique index access_tokens_live_dms_release_uidx on public.access_tokens (dead_man_switch_id, beneficiary_id)
  where grant_type = 'DMS_RELEASE' and revoked_at is null;
create unique index access_tokens_live_emergency_uidx on public.access_tokens (emergency_request_id)
  where grant_type = 'EMERGENCY_ACCESS' and revoked_at is null;

alter table public.emergency_access_requests
  add constraint ea_requests_access_token_fk
  foreign key (access_token_id) references public.access_tokens (id) on delete set null;
create index ea_requests_access_token_id_idx on public.emergency_access_requests (access_token_id);

-- =============================================================================
-- 16. beneficiary_assignments — Class B (assign_beneficiary / unassign_beneficiary)
-- =============================================================================
create table public.beneficiary_assignments (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.users (id) on delete cascade,
  beneficiary_id         uuid not null references public.beneficiaries (id) on delete cascade,
  resource_type          public.assignment_resource_type not null,
  resource_id            uuid not null,
  allocation_percentage  numeric(5, 2) check (allocation_percentage is null or (allocation_percentage >= 0 and allocation_percentage <= 100)),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (beneficiary_id, resource_type, resource_id)
);
create index beneficiary_assignments_user_id_idx on public.beneficiary_assignments (user_id);
create index beneficiary_assignments_resource_idx on public.beneficiary_assignments (resource_type, resource_id);
create trigger beneficiary_assignments_set_updated_at before update on public.beneficiary_assignments
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 26. document_attachments — Class B (attach_document / detach_document)
-- =============================================================================
create table public.document_attachments (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users (id) on delete cascade,
  document_id    uuid not null references public.documents (id) on delete cascade,
  resource_type  public.attachment_resource_type not null,
  resource_id    uuid not null,
  created_at     timestamptz not null default now(),
  unique (document_id, resource_type, resource_id)
);
create index document_attachments_resource_idx on public.document_attachments (resource_type, resource_id);
create index document_attachments_user_id_idx on public.document_attachments (user_id);

-- =============================================================================
-- 17. audit_log — Class C, append-only (trigger in 0002). No FK on actor so
--     rows outlive deleted accounts.
-- =============================================================================
create table public.audit_log (
  id              uuid primary key default gen_random_uuid(),
  actor_id        uuid,
  actor_role      text,
  action          text not null,
  resource_type   text not null,
  resource_id     uuid,
  outcome         public.audit_outcome not null,
  metadata        jsonb,
  ip_address      text,
  user_agent      text,
  correlation_id  text,
  created_at      timestamptz not null default now()
);
create index audit_log_actor_id_idx on public.audit_log (actor_id);
create index audit_log_action_idx on public.audit_log (action);
create index audit_log_resource_idx on public.audit_log (resource_type, resource_id);
create index audit_log_created_at_idx on public.audit_log (created_at);
create index audit_log_correlation_id_idx on public.audit_log (correlation_id);

-- =============================================================================
-- 27–28. ai_drafts / ai_draft_versions — Class B (ADR-016). The version FKs on
--        ai_drafts are added after ai_draft_versions exists (cycle).
-- =============================================================================
create table public.ai_drafts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.users (id) on delete cascade,
  kind                  public.ai_draft_kind not null,
  legacy_plan_id        uuid references public.legacy_plans (id) on delete set null,
  source_document_id    uuid references public.documents (id) on delete set null,
  status                public.ai_draft_status not null default 'DRAFT',
  current_version_id    uuid,
  confirmed_version_id  uuid,
  overall_confidence    numeric(4, 3) check (overall_confidence is null or (overall_confidence >= 0 and overall_confidence <= 1)),
  confirmed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  constraint ai_drafts_confirmed_consistency check ((status = 'CONFIRMED') = (confirmed_version_id is not null))
);
create index ai_drafts_user_id_idx on public.ai_drafts (user_id);
create index ai_drafts_kind_idx on public.ai_drafts (kind);
create index ai_drafts_status_idx on public.ai_drafts (status);
create index ai_drafts_legacy_plan_id_idx on public.ai_drafts (legacy_plan_id);
create index ai_drafts_source_document_id_idx on public.ai_drafts (source_document_id);
create trigger ai_drafts_set_updated_at before update on public.ai_drafts
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 18. ai_interactions — Class C (SELECT own). Sanitized: never content.
-- =============================================================================
create table public.ai_interactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users (id) on delete cascade,
  session_type    public.ai_session_type not null,
  provider        text not null,
  model           text,
  prompt_version  text,
  draft_id        uuid references public.ai_drafts (id) on delete set null,
  input_summary   text,
  output_summary  text,
  validation      jsonb,
  token_count     integer check (token_count is null or token_count >= 0),
  cost_estimate   numeric(12, 6) check (cost_estimate is null or cost_estimate >= 0),
  created_at      timestamptz not null default now()
);
create index ai_interactions_user_id_idx on public.ai_interactions (user_id);
create index ai_interactions_session_type_idx on public.ai_interactions (session_type);
create index ai_interactions_created_at_idx on public.ai_interactions (created_at);
create index ai_interactions_draft_id_idx on public.ai_interactions (draft_id);

create table public.ai_draft_versions (
  id                  uuid primary key default gen_random_uuid(),
  draft_id            uuid not null references public.ai_drafts (id) on delete cascade,
  version_number      integer not null check (version_number >= 1),
  created_by          public.ai_version_author not null,
  content             jsonb not null,                   -- ENCRYPTED envelope (ADR-016)
  section_confidence  jsonb,
  provider            text,
  model               text,
  prompt_version      text,
  interaction_id      uuid references public.ai_interactions (id) on delete set null,
  created_at          timestamptz not null default now(),
  unique (draft_id, version_number)
);
create index ai_draft_versions_interaction_id_idx on public.ai_draft_versions (interaction_id);

alter table public.ai_drafts
  add constraint ai_drafts_current_version_fk foreign key (current_version_id) references public.ai_draft_versions (id) on delete set null,
  add constraint ai_drafts_confirmed_version_fk foreign key (confirmed_version_id) references public.ai_draft_versions (id) on delete set null;
create index ai_drafts_current_version_id_idx on public.ai_drafts (current_version_id);
create index ai_drafts_confirmed_version_id_idx on public.ai_drafts (confirmed_version_id);

-- =============================================================================
-- 19. notifications — Class C + A (read_at)
-- =============================================================================
create table public.notifications (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.users (id) on delete cascade,
  type                 text not null,
  title                text not null,
  content              text not null,
  channel              public.notification_channel not null,
  delivery_status      public.notification_delivery_status not null default 'PENDING',
  provider_message_id  text,
  read_at              timestamptz,
  retry_count          integer not null default 0 check (retry_count >= 0),
  last_retry_at        timestamptz,
  metadata             jsonb,
  created_at           timestamptz not null default now()
);
create index notifications_user_read_idx on public.notifications (user_id, read_at);
create index notifications_type_idx on public.notifications (type);
create index notifications_delivery_status_idx on public.notifications (delivery_status);
create index notifications_provider_message_id_idx on public.notifications (provider_message_id);
create index notifications_created_at_idx on public.notifications (created_at);

-- =============================================================================
-- 22. jobs — Class C (ADR-006). Payloads never contain secrets or tokens.
-- =============================================================================
create table public.jobs (
  id               uuid primary key default gen_random_uuid(),
  type             text not null,
  payload          jsonb not null default '{}'::jsonb,
  status           public.job_status not null default 'QUEUED',
  run_at           timestamptz not null default now(),
  attempts         integer not null default 0 check (attempts >= 0),
  max_attempts     integer not null default 5 check (max_attempts >= 1),
  locked_at        timestamptz,
  locked_by        text,
  last_error       text,
  idempotency_key  text unique,
  progress         jsonb,
  finished_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index jobs_status_run_at_idx on public.jobs (status, run_at);
create index jobs_type_idx on public.jobs (type);
create index jobs_finished_at_idx on public.jobs (finished_at);
create trigger jobs_set_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 23. upload_sessions — Class C with SELECT own (ADR-005)
-- =============================================================================
create table public.upload_sessions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.users (id) on delete cascade,
  kind                 public.upload_kind not null,
  target_document_id   uuid references public.documents (id) on delete set null,
  declared_name        text not null,
  declared_mime_type   text not null,
  declared_size_bytes  bigint not null check (declared_size_bytes > 0),
  folder_id            uuid references public.folders (id) on delete set null,
  status               public.upload_status not null default 'PENDING',
  rejection_reason     text,
  expires_at           timestamptz not null default (now() + interval '1 hour'),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint upload_sessions_declared_size_limit check (
    (kind = 'VIDEO' and declared_size_bytes <= 524288000)
    or (kind <> 'VIDEO' and declared_size_bytes <= 52428800)
  ),
  constraint upload_sessions_version_target check (kind <> 'DOCUMENT_VERSION' or target_document_id is not null)
);
create index upload_sessions_user_id_idx on public.upload_sessions (user_id);
create index upload_sessions_status_idx on public.upload_sessions (status);
create index upload_sessions_expires_at_idx on public.upload_sessions (expires_at);
create index upload_sessions_target_document_id_idx on public.upload_sessions (target_document_id);
create index upload_sessions_folder_id_idx on public.upload_sessions (folder_id);
create trigger upload_sessions_set_updated_at before update on public.upload_sessions
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 24. rate_limits — Class C (ADR-007)
-- =============================================================================
create table public.rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  count         integer not null default 0 check (count >= 0),
  primary key (key, window_start)
);

-- =============================================================================
-- 29. processed_webhook_events — Class C (webhook idempotency)
-- =============================================================================
create table public.processed_webhook_events (
  provider      public.webhook_provider not null,
  event_id      text not null,
  event_type    text not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  primary key (provider, event_id)
);
create index processed_webhook_events_received_at_idx on public.processed_webhook_events (received_at);

-- -----------------------------------------------------------------------------
-- Table comments record the write class (data-model § Write-Protection Model)
-- -----------------------------------------------------------------------------
comment on table public.users is 'Class A (plain columns) + B (set_encrypted_fields). Identity columns protected.';
comment on table public.beneficiaries is 'Class A (contact fields) + B (status/removal).';
comment on table public.financial_assets is 'Class A (plain-column UPDATE) + B (create_asset/set_encrypted_fields/delete_asset).';
comment on table public.physical_assets is 'Class A (plain-column UPDATE) + B (create_asset/delete_asset).';
comment on table public.digital_assets is 'Class A (plain-column UPDATE) + B (create_asset/set_encrypted_fields/delete_asset).';
comment on table public.folders is 'Class A.';
comment on table public.documents is 'Class A (metadata columns) + B/C (lifecycle).';
comment on table public.document_versions is 'Class C (created by promote_upload).';
comment on table public.legacy_plans is 'Class B.';
comment on table public.legacy_plan_versions is 'Class B (created by finalize_legacy_plan).';
comment on table public.video_messages is 'Class A (metadata columns) + B/C (lifecycle).';
comment on table public.dead_man_switches is 'Class B.';
comment on table public.dead_man_switch_events is 'Class B/C, insert-only.';
comment on table public.dead_man_switch_contacts is 'Class B (dms_configure).';
comment on table public.emergency_access_configs is 'Class B.';
comment on table public.emergency_access_requests is 'Class B (owner decisions) / C (public + jobs).';
comment on table public.access_tokens is 'Class B (issue/revoke) / C (system grants). Hash only; plaintext never stored.';
comment on table public.beneficiary_assignments is 'Class B.';
comment on table public.document_attachments is 'Class B.';
comment on table public.audit_log is 'Class C, append-only.';
comment on table public.ai_drafts is 'Class B (ADR-016).';
comment on table public.ai_draft_versions is 'Class B (immutable versions, ADR-016).';
comment on table public.ai_interactions is 'Class C (SELECT own). Sanitized usage record — never content.';
comment on table public.notifications is 'Class C + A (read_at).';
comment on table public.jobs is 'Class C (ADR-006).';
comment on table public.upload_sessions is 'Class C with SELECT own (ADR-005).';
comment on table public.rate_limits is 'Class C (ADR-007).';
comment on table public.processed_webhook_events is 'Class C (webhook idempotency).';
