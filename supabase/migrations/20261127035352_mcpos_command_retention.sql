-- Staged privacy controls. Retention periods are provisional pending owner review.
begin;

create function public.mcpos_clear_terminal_payload()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status in ('completed','denied','failed','expired') then
    new.payload := '{}'::jsonb;
    if new.status <> 'completed' then new.result := null; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.mcpos_clear_terminal_payload() from public, anon, authenticated;
grant execute on function public.mcpos_clear_terminal_payload() to service_role;
create trigger mcpos_clear_terminal_payload before insert or update on public.mcpos_device_commands
for each row execute function public.mcpos_clear_terminal_payload();

-- Record the outcome of every device command in the workspace audit trail.
create or replace function public.complete_mcpos_device_command(
  p_token_hash text, p_command_id uuid, p_result jsonb, p_error_message text default null
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  v_device_id uuid;
  v_updated integer;
begin
  select c.device_id into v_device_id
  from public.mcpos_device_credentials c
  join public.mcpos_devices d on d.id = c.device_id
  where c.token_hash = p_token_hash and c.revoked_at is null and d.status <> 'revoked' and d.revoked_at is null
  limit 1;
  if v_device_id is null then
    raise exception 'invalid_device_credential' using errcode = 'P0001';
  end if;
  update public.mcpos_device_commands
     set status = case when p_error_message is null then 'completed'
                        when p_error_message like 'The user denied%' then 'denied'
                        else 'failed' end,
         result = case when p_error_message is null then coalesce(p_result, '{}'::jsonb) else null end,
         error_message = case when p_error_message is null then null when p_error_message like 'The user denied%' then 'The user denied the command.' else 'The device reported a command failure.' end,
         completed_at = pg_catalog.now()
   where id = p_command_id and device_id = v_device_id and status = 'claimed' and expires_at > pg_catalog.now()
     and public.authorize_mcpos_device_command(p_token_hash,p_command_id);
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    insert into public.mcpos_device_audit (user_id, device_id, event_type, outcome, metadata)
    select c.user_id, c.device_id, c.command || case when p_error_message is null then '.completed' when p_error_message like 'The user denied%' then '.denied' else '.failed' end,
      case when p_error_message is null then 'success'
           when p_error_message like 'The user denied%' then 'denied'
           else 'failure' end,
      pg_catalog.jsonb_build_object('command_id', c.id)
    from public.mcpos_device_commands c where c.id = p_command_id and c.device_id = v_device_id;
    return true;
  end if;
  return false;
end;
$$;

revoke all on function public.complete_mcpos_device_command(text,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.complete_mcpos_device_command(text,uuid,jsonb,text) to service_role;


-- One successful result delivery per client, even if two requests arrive concurrently.
create function public.consume_mcpos_command_result(p_user_id uuid, p_client_id uuid, p_command_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_row public.mcpos_device_commands%rowtype;
  v_result jsonb;
  v_status text;
begin
  select q.* into v_row from public.mcpos_device_commands q
  where q.id = p_command_id and q.user_id = p_user_id and q.mcp_client_id = p_client_id
    and exists (select 1 from public.mcpos_mcp_clients m where m.id = p_client_id and m.user_id = p_user_id
      and m.revoked_at is null and (m.token_expires_at is null or m.token_expires_at > pg_catalog.now())
      and 'workspace.read' = any(m.scopes))
  for update of q;
  if not found then return null; end if;
  v_status := v_row.status;
  if v_status in ('queued','claimed') and v_row.expires_at <= pg_catalog.now() then
    v_status := 'expired';
    update public.mcpos_device_commands set status = 'expired', result = null where id = v_row.id;
  end if;
  if v_status = 'completed' then
    if v_row.completed_at > pg_catalog.now() - interval '15 minutes'
      and v_row.result is not null and v_row.result <> '{"consumed":true}'::jsonb then
      v_result := v_row.result;
    else
      v_result := '{"consumed":true}'::jsonb;
    end if;
    update public.mcpos_device_commands set result = '{"consumed":true}'::jsonb, payload = '{}'::jsonb where id = v_row.id;
  end if;
  return pg_catalog.jsonb_build_object('id',v_row.id,'device_id',v_row.device_id,'command',v_row.command,
    'status',v_status,'result',v_result,'created_at',v_row.created_at,'expires_at',v_row.expires_at,
    'completed_at',v_row.completed_at,'error_message',case when v_status = 'denied' then 'Command denied.' when v_status = 'failed' then 'Command failed.' else null end);
end;
$$;
revoke all on function public.consume_mcpos_command_result(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.consume_mcpos_command_result(uuid,uuid,uuid) to service_role;

create function public.mcpos_purge_expired_command_data()
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_count integer;
begin
  with batch as (
    select id from public.mcpos_device_commands
    where (status in ('queued','claimed') and expires_at <= pg_catalog.now())
      or (status in ('completed','denied','failed','expired') and payload <> '{}'::jsonb)
      or (status = 'completed' and (completed_at is null or completed_at <= pg_catalog.now() - interval '15 minutes') and result is distinct from '{"consumed":true}'::jsonb)
      or (status in ('denied','failed','expired') and result is not null)
    order by created_at limit 500 for update skip locked
  )
  update public.mcpos_device_commands q set payload = '{}'::jsonb,
    status = case when q.status in ('queued','claimed') then 'expired' else q.status end,
    result = case when q.status = 'completed' and q.completed_at > pg_catalog.now() - interval '15 minutes' then q.result when q.status = 'completed' then '{"consumed":true}'::jsonb else null end
  from batch where q.id = batch.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.mcpos_purge_expired_command_data() from public, anon, authenticated;
grant execute on function public.mcpos_purge_expired_command_data() to service_role;

-- Scheduled inside Postgres, no external endpoint or exposed credential.
create extension if not exists pg_cron;
select cron.schedule('mcpos-purge-expired-command-data', '* * * * *', 'select public.mcpos_purge_expired_command_data();');
commit;
