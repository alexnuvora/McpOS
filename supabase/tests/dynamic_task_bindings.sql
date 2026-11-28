begin;
-- Test exact binding resolution without interacting with an actual device.
set local role service_role;
do $$
declare
  s jsonb := '{"scope":"targeted_window","windows":[{"name":"Calculator","windowId":[42,1]}],"controls":[{"label":"Seven","role":"button","windowId":[42,1],"controlId":[42,2]},{"label":"Seven","role":"text","windowId":[42,1],"controlId":[42,3]}]}'::jsonb;
  b jsonb := '{"binding":{"kind":"native_control","fromStep":1,"label":"Seven","role":"button"}}'::jsonb;
  r jsonb;
  rejected boolean;
begin
  r := public.mcpos_resolve_task_binding('native.invoke',b,s);
  if r is distinct from '{"windowId":[42,1],"controlId":[42,2]}'::jsonb then raise exception 'Native binding incorrect'; end if;
  r := public.mcpos_resolve_task_binding('desktop.accessibility','{"binding":{"kind":"window","fromStep":0,"label":"Calculator"}}',s);
  if r is distinct from '{"windowId":[42,1]}'::jsonb then raise exception 'Window binding incorrect'; end if;
  rejected := false;
  begin perform public.mcpos_resolve_task_binding('native.invoke',b #- '{binding,role}',s); exception when others then rejected := true; end;
  if not rejected then raise exception 'Ambiguous control accepted'; end if;
  rejected := false;
  begin perform public.mcpos_resolve_task_binding('native.invoke',b,'{"consumed":true}'); exception when others then rejected := true; end;
  if not rejected then raise exception 'Consumed snapshot accepted'; end if;
  r := public.mcpos_resolve_task_binding('browser.type','{"binding":{"kind":"browser_element","fromStep":0,"label":"Search"},"text":"test"}','{"browser_window":"mcpos-isolated-browser-test","interactive":[{"label":"Search","elementId":"mcpos:test:1","editable":true,"disabled":false,"sensitive":false}]}');
  if r is distinct from '{"windowId":"mcpos-isolated-browser-test","selector":"mcpos:test:1","text":"test"}'::jsonb then raise exception 'Browser binding incorrect'; end if;
  rejected := false;
  begin perform public.mcpos_resolve_task_binding('browser.type','{"binding":{"kind":"browser_element","fromStep":0,"label":"Password"},"text":"test"}','{"browser_window":"mcpos-isolated-browser-test","interactive":[{"label":"Password","elementId":"mcpos:test:1","editable":true,"disabled":false,"sensitive":true}]}'); exception when others then rejected := true; end;
  if not rejected then raise exception 'Sensitive field accepted'; end if;
end $$;
reset role;
-- Test actual ordered claims, including source isolation and failure stopping.
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111');
insert into public.mcpos_devices(id,user_id,device_name,status) values ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','CI fixture','online');
insert into public.mcpos_device_credentials(device_id,token_hash) values ('33333333-3333-4333-8333-333333333333','ci-dynamic-device-token');
insert into public.mcpos_mcp_clients(id,user_id,client_name,token_hash,scopes,token_expires_at) values
('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','Dynamic','ci-dynamic',array['desktop.status','screen.accessibility','input.keyboard','workspace.read'],now()+interval '1 hour');
insert into public.mcpos_device_commands(user_id,device_id,mcp_client_id,command,task_id,task_step,payload)
select '11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444', command,'77777777-7777-4777-8777-777777777777',step,payload from (values
 (0,'desktop.accessibility','{}'::jsonb),
 (1,'desktop.accessibility','{"binding":{"kind":"window","fromStep":0,"label":"Calculator"}}'::jsonb),
 (2,'native.invoke','{"binding":{"kind":"native_control","fromStep":1,"label":"Seven","role":"button"}}'::jsonb),
 (3,'native.invoke','{"binding":{"kind":"native_control","fromStep":1,"label":"Missing"}}'::jsonb),
 (4,'desktop.status','{}'::jsonb)) steps(step,command,payload);
set local role service_role;
do $$
declare q jsonb;
begin
 q := public.claim_mcpos_device_command('ci-dynamic-device-token');
 perform public.complete_mcpos_device_command('ci-dynamic-device-token',(q->>'id')::uuid,'{"windows":[{"name":"Calculator","windowId":[42,1]}]}',null);
 q := public.claim_mcpos_device_command('ci-dynamic-device-token');
 if q->'payload' is distinct from '{"windowId":[42,1]}'::jsonb then raise exception 'Claim did not resolve window'; end if;
 perform public.complete_mcpos_device_command('ci-dynamic-device-token',(q->>'id')::uuid,'{"scope":"targeted_window","controls":[{"label":"Seven","role":"button","windowId":[42,1],"controlId":[42,2]}]}',null);
 q := public.claim_mcpos_device_command('ci-dynamic-device-token');
 if q->'payload' is distinct from '{"windowId":[42,1],"controlId":[42,2]}'::jsonb then raise exception 'Claim did not resolve control'; end if;
 perform public.complete_mcpos_device_command('ci-dynamic-device-token',(q->>'id')::uuid,'{}',null);
 if public.claim_mcpos_device_command('ci-dynamic-device-token') is not null then raise exception 'Missing target dispatched'; end if;
 if (select status from public.mcpos_device_commands where task_id='77777777-7777-4777-8777-777777777777' and task_step=3) is distinct from 'failed' then raise exception 'Missing binding did not fail'; end if;
 if public.claim_mcpos_device_command('ci-dynamic-device-token') is not null then raise exception 'Successor dispatched after failure'; end if;
end $$;
rollback;
