-- McpOS remote MCP clients and outbound desktop command relay.
-- Client and device credentials are stored only as SHA-256 hashes. All grants default to deny.

create table if not exists public.mcpos_mcp_clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_name text not null check (char_length(client_name) between 1 and 80),
  token_hash text not null unique,
  scopes text[] not null default array['workspace.read','desktop.status']::text[],
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists mcpos_mcp_clients_user_idx on public.mcpos_mcp_clients(user_id);
alter table public.mcpos_mcp_clients enable row level security;
revoke all on public.mcpos_mcp_clients from anon, authenticated;
grant all on public.mcpos_mcp_clients to service_role;

create table if not exists public.mcpos_device_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.mcpos_devices(id) on delete cascade,
  command text not null check (command in ('desktop.status')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','claimed','completed','denied','failed','expired')),
  result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '45 seconds'),
  claimed_at timestamptz,
  completed_at timestamptz
);
create index if not exists mcpos_device_commands_device_queue_idx
  on public.mcpos_device_commands(device_id, status, created_at);
create index if not exists mcpos_device_commands_user_created_idx
  on public.mcpos_device_commands(user_id, created_at desc);
alter table public.mcpos_device_commands enable row level security;
revoke all on public.mcpos_device_commands from anon, authenticated;
grant all on public.mcpos_device_commands to service_role;

create or replace function public.claim_mcpos_device_command(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_id uuid;
  v_command public.mcpos_device_commands%rowtype;
begin
  select d.id into v_device_id
  from public.mcpos_device_credentials c
  join public.mcpos_devices d on d.id = c.device_id
  where c.token_hash = p_token_hash
    and c.revoked_at is null
    and d.status <> 'revoked'
  limit 1;
  if v_device_id is null then
    raise exception 'invalid_device_credential' using errcode = 'P0001';
  end if;

  select * into v_command
  from public.mcpos_device_commands
  where device_id = v_device_id
    and status = 'queued'
    and expires_at > pg_catalog.now()
  order by created_at
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.mcpos_device_commands
     set status = 'claimed', claimed_at = pg_catalog.now()
   where id = v_command.id;

  return pg_catalog.jsonb_build_object(
    'id', v_command.id,
    'command', v_command.command,
    'payload', v_command.payload,
    'expires_at', v_command.expires_at
  );
end;
$$;

create or replace function public.complete_mcpos_device_command(
  p_token_hash text,
  p_command_id uuid,
  p_result jsonb,
  p_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_id uuid;
  v_updated integer;
begin
  select c.device_id into v_device_id
  from public.mcpos_device_credentials c
  join public.mcpos_devices d on d.id = c.device_id
  where c.token_hash = p_token_hash
    and c.revoked_at is null
    and d.status <> 'revoked'
  limit 1;
  if v_device_id is null then
    raise exception 'invalid_device_credential' using errcode = 'P0001';
  end if;

  update public.mcpos_device_commands
     set status = case when p_error_message is null then 'completed' else 'failed' end,
         result = coalesce(p_result, '{}'::jsonb),
         error_message = case when p_error_message is null then null else left(p_error_message, 500) end,
         completed_at = pg_catalog.now()
   where id = p_command_id
     and device_id = v_device_id
     and status = 'claimed'
     and expires_at > pg_catalog.now();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.claim_mcpos_device_command(text) from public, anon, authenticated;
revoke all on function public.complete_mcpos_device_command(text,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.claim_mcpos_device_command(text) to service_role;
grant execute on function public.complete_mcpos_device_command(text,uuid,jsonb,text) to service_role;


-- Device status is the sole non-sensitive capability enabled at pairing time.
-- All observation, input, browser, app and file capabilities remain disabled.
create or replace function public.complete_mcpos_pairing(p_code_hash text, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_code public.mcpos_pairing_codes%rowtype;
  v_device_id uuid;
begin
  update public.mcpos_pairing_codes as pc
     set consumed_at = pg_catalog.now()
   where pc.code_hash = p_code_hash and pc.consumed_at is null and pc.expires_at > pg_catalog.now()
  returning pc.* into v_code;
  if not found then
    raise exception 'invalid_or_expired_pairing_code' using errcode = 'P0001';
  end if;
  insert into public.mcpos_devices (user_id, device_name, platform, status)
  values (v_code.user_id, v_code.device_name, 'windows', 'offline')
  returning id into v_device_id;
  insert into public.mcpos_device_credentials (device_id, token_hash) values (v_device_id, p_token_hash);
  insert into public.mcpos_device_permissions (device_id, capability, enabled)
  select v_device_id, capability, capability = 'desktop.status'
  from pg_catalog.unnest(array[
    'desktop.status','screen.capture','screen.accessibility','input.pointer','input.keyboard',
    'browser.control','files.read','files.write','apps.launch'
  ]::text[]) as capability;
  insert into public.mcpos_device_audit (user_id, device_id, event_type, outcome, metadata)
  values (v_code.user_id, v_device_id, 'device.paired', 'success', pg_catalog.jsonb_build_object('platform','windows'));
  return pg_catalog.jsonb_build_object('device_id',v_device_id,'device_name',v_code.device_name);
end;
$$;
revoke all on function public.complete_mcpos_pairing(text,text) from public, anon, authenticated;
grant execute on function public.complete_mcpos_pairing(text,text) to service_role;

update public.mcpos_device_permissions
   set enabled = true, updated_at = pg_catalog.now()
 where capability = 'desktop.status';
