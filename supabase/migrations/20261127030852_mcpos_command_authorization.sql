-- Reject orphaned, cross-account, revoked, expired and out-of-scope commands at claim and authorization.
-- Static client keys retain their existing null-expiry semantics.
begin;
create or replace function public.claim_mcpos_device_command(p_token_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_device_id uuid;
  v_user_id uuid;
  v_command public.mcpos_device_commands%rowtype;
begin
  select d.id, d.user_id into v_device_id, v_user_id
  from public.mcpos_device_credentials c
  join public.mcpos_devices d on d.id = c.device_id
  where c.token_hash = p_token_hash and c.revoked_at is null and d.status <> 'revoked' and d.revoked_at is null
  limit 1;
  if v_device_id is null then raise exception 'invalid_device_credential' using errcode = 'P0001'; end if;
  select * into v_command
  from public.mcpos_device_commands q
  where q.device_id = v_device_id and q.user_id = v_user_id and q.status = 'queued' and q.expires_at > pg_catalog.now()
    and exists (
      select 1 from public.mcpos_mcp_clients m
      where m.id = q.mcp_client_id and m.user_id = q.user_id
        and m.revoked_at is null
        and (m.token_expires_at is null or m.token_expires_at > pg_catalog.now())
        and (case
          when q.command = 'desktop.status' then 'desktop.status'
          when q.command = 'screen.capture' then 'screen.capture'
          when q.command = 'desktop.accessibility' then 'screen.accessibility'
          when q.command in ('files.list','files.read') then 'files.read'
          when q.command in ('input.pointer.click','input.pointer.move','input.pointer.scroll') then 'input.pointer'
          when q.command in ('input.keyboard.type','input.keyboard.shortcut') then 'input.keyboard'
          when q.command in ('browser.open','browser.snapshot','browser.click','browser.type') then 'browser.control'
          else null
        end) = any(m.scopes)
    )
  order by q.created_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.mcpos_device_commands set status = 'claimed', claimed_at = pg_catalog.now() where id = v_command.id;
  return pg_catalog.jsonb_build_object('id',v_command.id,'command',v_command.command,'payload',v_command.payload,'expires_at',v_command.expires_at);
end;
$$;

create or replace function public.authorize_mcpos_device_command(p_token_hash text, p_command_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_device_id uuid;
  v_user_id uuid;
begin
  select d.id, d.user_id into v_device_id, v_user_id
  from public.mcpos_device_credentials c
  join public.mcpos_devices d on d.id = c.device_id
  where c.token_hash = p_token_hash and c.revoked_at is null and d.status <> 'revoked' and d.revoked_at is null
  limit 1;
  if v_device_id is null then raise exception 'invalid_device_credential' using errcode = 'P0001'; end if;
  return exists (
    select 1 from public.mcpos_device_commands q
    where q.id = p_command_id and q.device_id = v_device_id and q.user_id = v_user_id and q.status = 'claimed' and q.expires_at > pg_catalog.now()
      and exists (
      select 1 from public.mcpos_mcp_clients m
      where m.id = q.mcp_client_id and m.user_id = q.user_id
        and m.revoked_at is null
        and (m.token_expires_at is null or m.token_expires_at > pg_catalog.now())
        and (case
          when q.command = 'desktop.status' then 'desktop.status'
          when q.command = 'screen.capture' then 'screen.capture'
          when q.command = 'desktop.accessibility' then 'screen.accessibility'
          when q.command in ('files.list','files.read') then 'files.read'
          when q.command in ('input.pointer.click','input.pointer.move','input.pointer.scroll') then 'input.pointer'
          when q.command in ('input.keyboard.type','input.keyboard.shortcut') then 'input.keyboard'
          when q.command in ('browser.open','browser.snapshot','browser.click','browser.type') then 'browser.control'
          else null
        end) = any(m.scopes)
    )
  );
end;
$$;

revoke all on function public.claim_mcpos_device_command(text) from public, anon, authenticated;
revoke all on function public.authorize_mcpos_device_command(text,uuid) from public, anon, authenticated;
grant execute on function public.claim_mcpos_device_command(text) to service_role;
grant execute on function public.authorize_mcpos_device_command(text,uuid) to service_role;

commit;
