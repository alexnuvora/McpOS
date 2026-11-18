-- Bind queued desktop commands to the AI client that requested them so revocation cancels pending work.
alter table public.mcpos_device_commands
  add column if not exists mcp_client_id uuid references public.mcpos_mcp_clients(id) on delete set null;
create index if not exists mcpos_device_commands_client_idx
  on public.mcpos_device_commands(mcp_client_id, status) where mcp_client_id is not null;

create or replace function public.claim_mcpos_device_command(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_device_id uuid;
  v_command public.mcpos_device_commands%rowtype;
begin
  select d.id into v_device_id
  from public.mcpos_device_credentials c
  join public.mcpos_devices d on d.id = c.device_id
  where c.token_hash = p_token_hash and c.revoked_at is null and d.status <> 'revoked'
  limit 1;
  if v_device_id is null then raise exception 'invalid_device_credential' using errcode = 'P0001'; end if;
  select * into v_command
  from public.mcpos_device_commands q
  where q.device_id = v_device_id and q.status = 'queued' and q.expires_at > pg_catalog.now()
    and (q.mcp_client_id is null or exists (select 1 from public.mcpos_mcp_clients m where m.id = q.mcp_client_id and m.revoked_at is null))
  order by q.created_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.mcpos_device_commands set status = 'claimed', claimed_at = pg_catalog.now() where id = v_command.id;
  return pg_catalog.jsonb_build_object('id',v_command.id,'command',v_command.command,'payload',v_command.payload,'expires_at',v_command.expires_at);
end;
$$;

create or replace function public.authorize_mcpos_device_command(p_token_hash text, p_command_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_device_id uuid;
begin
  select d.id into v_device_id
  from public.mcpos_device_credentials c
  join public.mcpos_devices d on d.id = c.device_id
  where c.token_hash = p_token_hash and c.revoked_at is null and d.status <> 'revoked'
  limit 1;
  if v_device_id is null then raise exception 'invalid_device_credential' using errcode = 'P0001'; end if;
  return exists (
    select 1 from public.mcpos_device_commands q
    where q.id = p_command_id and q.device_id = v_device_id and q.status = 'claimed' and q.expires_at > pg_catalog.now()
      and (q.mcp_client_id is null or exists (select 1 from public.mcpos_mcp_clients m where m.id = q.mcp_client_id and m.revoked_at is null))
  );
end;
$$;

revoke all on function public.claim_mcpos_device_command(text) from public, anon, authenticated;
revoke all on function public.authorize_mcpos_device_command(text,uuid) from public, anon, authenticated;
grant execute on function public.claim_mcpos_device_command(text) to service_role;
grant execute on function public.authorize_mcpos_device_command(text,uuid) to service_role;
