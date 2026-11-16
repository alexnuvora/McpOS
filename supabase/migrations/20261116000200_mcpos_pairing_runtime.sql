-- Runtime support for McpOS device pairing and GitHub-backed workspace identity.
create table if not exists public.mcpos_github_accounts (
  github_user_id bigint primary key,
  github_login text not null,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.mcpos_github_accounts enable row level security;
revoke all on public.mcpos_github_accounts from anon, authenticated;
grant all on public.mcpos_github_accounts to service_role;

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
  select v_device_id, capability, false from pg_catalog.unnest(array[
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
