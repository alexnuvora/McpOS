-- Local disposable database only. Roll back every fixture.
begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
insert into public.mcpos_devices(id,user_id,device_name,status) values ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','CI fixture','online');
insert into public.mcpos_device_credentials(device_id,token_hash) values ('33333333-3333-4333-8333-333333333333','ci-fixture-device-token');
insert into public.mcpos_mcp_clients(id,user_id,client_name,token_hash,scopes,token_expires_at) values
('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','Valid','ci-valid',array['desktop.status'],now()+interval '1 hour'),
('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','Other account','ci-other',array['desktop.status'],null),
('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111','Expired','ci-expired',array['desktop.status'],now()-interval '1 hour');
insert into public.mcpos_device_commands(user_id, device_id, mcp_client_id, command, task_id, task_step)
select '11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444',
 'desktop.status','77777777-7777-4777-8777-777777777777', i from generate_series(0,2) i order by i desc;
set local role service_role;
do $$
declare current_id uuid;
begin
  select (public.claim_mcpos_device_command('ci-fixture-device-token')->>'id')::uuid into current_id;
  if (select task_step from public.mcpos_device_commands where id=current_id) is distinct from 0 then raise exception 'First step missing'; end if;
  if public.claim_mcpos_device_command('ci-fixture-device-token') is not null then raise exception 'Overlapping claims'; end if;
  perform public.complete_mcpos_device_command('ci-fixture-device-token',current_id,'{}',null);
  select (public.claim_mcpos_device_command('ci-fixture-device-token')->>'id')::uuid into current_id;
  if (select task_step from public.mcpos_device_commands where id=current_id) is distinct from 1 then raise exception 'Successor missing'; end if;
  perform public.complete_mcpos_device_command('ci-fixture-device-token',current_id,'{}','Local action failed');
  if public.claim_mcpos_device_command('ci-fixture-device-token') is not null then raise exception 'Executed after failure'; end if;
end $$;
rollback;
