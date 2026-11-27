-- Disposable database fixtures only.
begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
insert into public.mcpos_devices(id,user_id,device_name,status) values ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','CI fixture','online');
insert into public.mcpos_device_credentials(device_id,token_hash) values ('33333333-3333-4333-8333-333333333333','ci-retention-device');
insert into public.mcpos_mcp_clients(id,user_id,client_name,token_hash,scopes) values
('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','CI fixture','ci-retention-client',array['workspace.read','desktop.status']),
('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','Other','ci-retention-other',array['workspace.read']);
set local role service_role;
insert into public.mcpos_device_commands(id,user_id,device_id,mcp_client_id,command,status,payload,result,completed_at,expires_at) values
('77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','desktop.status','completed','{"private":"fixture"}','{"answer":"fixture"}',now(),now()+interval '1 minute'),
('88888888-8888-4888-8888-888888888888','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','desktop.status','completed','{}','{"old":"fixture"}',now()-interval '16 minutes',now()-interval '15 minutes'),
('99999999-9999-4999-8999-999999999999','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','desktop.status','queued','{"private":"fixture"}',null,null,now()-interval '1 minute');
do $$
declare r jsonb;
begin
  if (select payload from public.mcpos_device_commands where id='77777777-7777-4777-8777-777777777777') <> '{}'::jsonb then raise exception 'Terminal payload retained'; end if;
  r := public.consume_mcpos_command_result('22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555','77777777-7777-4777-8777-777777777777');
  if r is not null then raise exception 'Cross-account result access'; end if;
  r := public.consume_mcpos_command_result('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','77777777-7777-4777-8777-777777777777');
  if r->'result' is distinct from '{"answer":"fixture"}'::jsonb then raise exception 'First delivery missing'; end if;
  r := public.consume_mcpos_command_result('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','77777777-7777-4777-8777-777777777777');
  if r->'result' is distinct from '{"consumed":true}'::jsonb then raise exception 'Result delivered twice'; end if;
  perform public.mcpos_purge_expired_command_data();
  if (select result from public.mcpos_device_commands where id='88888888-8888-4888-8888-888888888888') is distinct from '{"consumed":true}'::jsonb then raise exception 'Expired result retained'; end if;
  if not exists(select 1 from public.mcpos_device_commands where id='99999999-9999-4999-8999-999999999999' and status='expired' and payload='{}'::jsonb) then raise exception 'Expired payload retained'; end if;
end $$;
reset role;
do $$ begin
  if not exists(select 1 from cron.job where jobname='mcpos-purge-expired-command-data' and active) then raise exception 'Cleanup schedule missing'; end if;
  if has_function_privilege('authenticated','public.consume_mcpos_command_result(uuid,uuid,uuid)','EXECUTE') or has_function_privilege('anon','public.mcpos_purge_expired_command_data()','EXECUTE') then raise exception 'Unexpected public RPC privileges'; end if;
end $$;
rollback;
