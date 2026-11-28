begin;
-- Resolve only target identifiers. Never substitute earlier free text into executable actions.
create function public.mcpos_bind_task_targets() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  successor public.mcpos_device_commands%rowtype;
  field text;
  binding jsonb;
  value jsonb;
  updated jsonb;
  missing boolean;
begin
  for successor in select * from public.mcpos_device_commands q
    where q.task_id = new.task_id and q.user_id = new.user_id and q.device_id = new.device_id
      and q.mcp_client_id = new.mcp_client_id and q.task_step > new.task_step
      and q.status = 'queued' and q.payload ? 'bindings' order by q.task_step for update
  loop
    updated := successor.payload;
    missing := false;
    for field, binding in select * from pg_catalog.jsonb_each(updated->'bindings') loop
      if binding->'step' is distinct from pg_catalog.to_jsonb(new.task_step) then continue; end if;
      if field not in ('selector','windowId') then missing := true; exit; end if;
      value := new.result->field;
      if field = 'windowId' and pg_catalog.jsonb_typeof(value) is distinct from 'array' then missing := true; exit; end if;
      if field = 'selector' and (pg_catalog.jsonb_typeof(value) is distinct from 'string' or new.result->>'selector' not like 'mcpos:%') then missing := true; exit; end if;
      updated := pg_catalog.jsonb_set(updated,array[field],value,true);
      if field = 'selector' then
        if pg_catalog.jsonb_typeof(new.result->'browser_window') is distinct from 'string' then missing := true; exit; end if;
        updated := pg_catalog.jsonb_set(updated,'{windowId}',new.result->'browser_window',true);
      end if;
      updated := updated #- array['bindings',field];
    end loop;
    if missing then
      update public.mcpos_device_commands set status='failed', completed_at=now(), error_message='Previous step did not return a verified target' where id=successor.id;
    elsif updated is distinct from successor.payload then
      if updated->'bindings' = '{}'::jsonb then updated := updated-'bindings'; end if;
      update public.mcpos_device_commands set payload=updated where id=successor.id;
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.mcpos_bind_task_targets() from public, anon, authenticated;
grant execute on function public.mcpos_bind_task_targets() to service_role;
create trigger mcpos_task_result_targets after update of status on public.mcpos_device_commands
for each row when (new.task_id is not null and new.status='completed' and old.status='claimed')
execute function public.mcpos_bind_task_targets();
commit;
