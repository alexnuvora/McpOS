begin;
-- Resolve only explicitly supported references in the same authenticated ordered task.
create function public.mcpos_resolve_task_binding(p_command text, p_payload jsonb, p_source jsonb)
returns jsonb language plpgsql immutable security invoker set search_path = '' as $$
declare
  b jsonb := p_payload->'binding';
  candidate jsonb;
  matches integer;
  resolved jsonb := p_payload - 'binding';
begin
  if jsonb_typeof(b) is distinct from 'object' or p_source is null then
    raise exception 'Dynamic binding source unavailable';
  end if;
  if b->>'kind' = 'window' and p_command in ('desktop.accessibility','desktop.focus') then
    if jsonb_typeof(p_source->'windows') is distinct from 'array' then raise exception 'Expected window snapshot'; end if;
    select count(*), (jsonb_agg(w)->0) into matches,candidate
    from jsonb_array_elements(p_source->'windows') w
    where w->>'name' = b->>'label' and jsonb_typeof(w->'windowId') = 'array';
    if matches <> 1 then raise exception 'Window label must match exactly one window'; end if;
    return resolved || jsonb_build_object('windowId',candidate->'windowId');
  elsif b->>'kind' = 'native_control' and p_command in ('native.invoke','native.set_text') then
    if p_source->>'scope' is distinct from 'targeted_window' or jsonb_typeof(p_source->'controls') is distinct from 'array' then raise exception 'Expected targeted accessibility snapshot'; end if;
    select count(*), (jsonb_agg(w)->0) into matches,candidate
    from jsonb_array_elements(p_source->'controls') w
    where w->>'label' = b->>'label' and (not (b ? 'role') or w->>'role' = b->>'role')
      and jsonb_typeof(w->'windowId') = 'array' and jsonb_typeof(w->'controlId') = 'array';
    if matches <> 1 then raise exception 'Control label must match exactly one control'; end if;
    return resolved || jsonb_build_object('windowId',candidate->'windowId','controlId',candidate->'controlId');
  elsif b->>'kind' = 'browser_element' and p_command in ('browser.click','browser.type','browser.open') then
    if p_command = 'browser.open' and p_payload->>'windowAction' is distinct from 'browser.verified_click' then raise exception 'Invalid browser binding operation'; end if;
    if jsonb_typeof(p_source->'interactive') is distinct from 'array' or p_source->>'browser_window' is null then raise exception 'Expected browser snapshot'; end if;
    select count(*), (jsonb_agg(w)->0) into matches,candidate
    from jsonb_array_elements(p_source->'interactive') w
    where w->>'label' = b->>'label' and (not (b ? 'role') or w->>'role' = b->>'role')
      and w->>'disabled' = 'false' and w->>'sensitive' = 'false'
      and (p_command <> 'browser.type' or w->>'editable' = 'true')
      and w->>'elementId' like 'mcpos:%';
    if matches <> 1 then raise exception 'Browser label must match exactly one eligible element'; end if;
    return resolved || jsonb_build_object('selector',candidate->'elementId','windowId',p_source->'browser_window');
  end if;
  raise exception 'Unsupported dynamic binding';
end;
$$;
revoke all on function public.mcpos_resolve_task_binding(text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.mcpos_resolve_task_binding(text,jsonb,jsonb) to service_role;

alter function public.claim_mcpos_device_command(text) rename to claim_mcpos_device_command_static;
create function public.claim_mcpos_device_command(p_token_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  claimed jsonb;
  q public.mcpos_device_commands%rowtype;
  source public.mcpos_device_commands%rowtype;
  resolved jsonb;
  ref integer;
begin
  -- Existing claim implementation retains all credential, scope, billing and ordering checks.
  claimed := public.claim_mcpos_device_command_static(p_token_hash);
  if claimed is null or not ((claimed->'payload') ? 'binding') then return claimed; end if;
  select * into q from public.mcpos_device_commands where id = (claimed->>'id')::uuid;
  begin
    ref := (q.payload->'binding'->>'fromStep')::integer;
    if q.task_id is null or ref is null or ref < 0 or ref >= q.task_step then raise exception 'Invalid earlier step reference'; end if;
    select * into source from public.mcpos_device_commands
      where task_id=q.task_id and task_step=ref and device_id=q.device_id
        and user_id=q.user_id and mcp_client_id=q.mcp_client_id and status='completed';
    if not found or source.result is null or source.result = '{"consumed":true}'::jsonb then raise exception 'Dynamic binding source missing or consumed'; end if;
    if (q.payload->'binding'->>'kind' in ('window','native_control') and source.command <> 'desktop.accessibility')
      or (q.payload->'binding'->>'kind' = 'browser_element' and source.command <> 'browser.snapshot') then raise exception 'Wrong source command'; end if;
    resolved := public.mcpos_resolve_task_binding(q.command,q.payload,source.result);
    update public.mcpos_device_commands set payload=resolved where id=q.id;
    return jsonb_set(claimed,'{payload}',resolved);
  exception when others then
    update public.mcpos_device_commands set status='failed', completed_at=pg_catalog.now(), error_message='Dynamic binding could not resolve uniquely; inspect snapshots before retrying.' where id=q.id;
    return null;
  end;
end;
$$;
revoke all on function public.claim_mcpos_device_command(text) from public, anon, authenticated;
grant execute on function public.claim_mcpos_device_command(text) to service_role;
notify pgrst, 'reload schema';
commit;
