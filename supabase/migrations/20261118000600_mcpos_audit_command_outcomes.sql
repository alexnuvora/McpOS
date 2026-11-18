-- Record the outcome of every device command in the workspace audit trail.
create or replace function public.complete_mcpos_device_command(
  p_token_hash text, p_command_id uuid, p_result jsonb, p_error_message text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_device_id uuid;
  v_updated integer;
begin
  select c.device_id into v_device_id
  from public.mcpos_device_credentials c
  join public.mcpos_devices d on d.id = c.device_id
  where c.token_hash = p_token_hash and c.revoked_at is null and d.status <> 'revoked'
  limit 1;
  if v_device_id is null then
    raise exception 'invalid_device_credential' using errcode = 'P0001';
  end if;
  update public.mcpos_device_commands
     set status = case when p_error_message is null then 'completed'
                        when p_error_message like 'The user denied%' then 'denied'
                        else 'failed' end,
         result = coalesce(p_result, '{}'::jsonb),
         error_message = case when p_error_message is null then null else left(p_error_message, 500) end,
         completed_at = pg_catalog.now()
   where id = p_command_id and device_id = v_device_id and status = 'claimed' and expires_at > pg_catalog.now();
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    insert into public.mcpos_device_audit (user_id, device_id, event_type, outcome, metadata)
    select c.user_id, c.device_id, c.command || case when p_error_message is null then '.completed' when p_error_message like 'The user denied%' then '.denied' else '.failed' end,
      case when p_error_message is null then 'success'
           when p_error_message like 'The user denied%' then 'denied'
           else 'failure' end,
      pg_catalog.jsonb_build_object('command_id', c.id, 'error_message', case when p_error_message is null then null else left(p_error_message, 200) end)
    from public.mcpos_device_commands c where c.id = p_command_id and c.device_id = v_device_id;
    return true;
  end if;
  return false;
end;
$$;

revoke all on function public.complete_mcpos_device_command(text,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.complete_mcpos_device_command(text,uuid,jsonb,text) to service_role;
