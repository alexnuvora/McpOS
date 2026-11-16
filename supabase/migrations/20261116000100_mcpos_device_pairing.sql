-- McpOS device identity and pairing foundation.
-- All device access is deny-by-default. Raw credentials are never stored.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.mcpos_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_name text not null check (char_length(device_name) between 1 and 120),
  platform text not null default 'windows' check (platform in ('windows')),
  status text not null default 'offline' check (status in ('offline','online','revoked')),
  last_seen_at timestamptz,
  paired_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists mcpos_devices_user_idx on public.mcpos_devices(user_id);
create index if not exists mcpos_devices_status_idx on public.mcpos_devices(status);

create table if not exists public.mcpos_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique,
  device_name text not null check (char_length(device_name) between 1 and 120),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists mcpos_pairing_codes_expiry_idx on public.mcpos_pairing_codes(expires_at);

create table if not exists public.mcpos_device_credentials (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.mcpos_devices(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists mcpos_device_credentials_device_idx on public.mcpos_device_credentials(device_id);

create table if not exists public.mcpos_device_permissions (
  device_id uuid not null references public.mcpos_devices(id) on delete cascade,
  capability text not null check (capability in (
    'desktop.status','screen.capture','screen.accessibility',
    'input.pointer','input.keyboard','browser.control',
    'files.read','files.write','apps.launch'
  )),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (device_id, capability)
);

create table if not exists public.mcpos_device_audit (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.mcpos_devices(id) on delete set null,
  event_type text not null,
  outcome text not null default 'success' check (outcome in ('success','denied','failure')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists mcpos_device_audit_user_created_idx
  on public.mcpos_device_audit(user_id, created_at desc);

alter table public.mcpos_devices enable row level security;
alter table public.mcpos_pairing_codes enable row level security;
alter table public.mcpos_device_credentials enable row level security;
alter table public.mcpos_device_permissions enable row level security;
alter table public.mcpos_device_audit enable row level security;

drop policy if exists "Users read own McpOS devices" on public.mcpos_devices;
create policy "Users read own McpOS devices"
  on public.mcpos_devices for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users read own McpOS permissions" on public.mcpos_device_permissions;
create policy "Users read own McpOS permissions"
  on public.mcpos_device_permissions for select to authenticated
  using (exists (
    select 1 from public.mcpos_devices d
    where d.id = device_id and d.user_id = auth.uid()
  ));

drop policy if exists "Users read own McpOS audit" on public.mcpos_device_audit;
create policy "Users read own McpOS audit"
  on public.mcpos_device_audit for select to authenticated
  using (auth.uid() = user_id);

-- Pairing codes, device credentials, audit writes and device state changes
-- are server-only. No client-side INSERT/UPDATE/DELETE policies are granted.
revoke all on public.mcpos_pairing_codes from anon, authenticated;
revoke all on public.mcpos_device_credentials from anon, authenticated;
revoke insert, update, delete on public.mcpos_devices from anon, authenticated;
revoke insert, update, delete on public.mcpos_device_permissions from anon, authenticated;
revoke insert, update, delete on public.mcpos_device_audit from anon, authenticated;

grant select on public.mcpos_devices to authenticated;
grant select on public.mcpos_device_permissions to authenticated;
grant select on public.mcpos_device_audit to authenticated;
