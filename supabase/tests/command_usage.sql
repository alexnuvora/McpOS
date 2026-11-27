-- Disposable local database only; fixture transaction is rolled back.
begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111');
insert into public.mcpos_devices(id,user_id,device_name,status) values ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','CI fixture','online');
insert into public.mcpos_device_credentials(device_id,token_hash) values ('33333333-3333-4333-8333-333333333333','ci-usage-device');
insert into public.mcpos_mcp_clients(id,user_id,client_name,token_hash,scopes) values ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','CI fixture','ci-usage-client',array['desktop.status']);
set local role service_role;
insert into public.mcpos_daily_command_usage(user_id,usage_date,command_count) values ('11111111-1111-4111-8111-111111111111',(now() at time zone 'UTC')::date,499);
insert into public.mcpos_device_commands(id,user_id,device_id,mcp_client_id,command,expires_at,billing_plan,billing_verified_until) values ('77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','desktop.status',now()+interval '1 minute','personal',now()+interval '75 seconds');
do $$
begin
  if (select command_count from public.mcpos_daily_command_usage where user_id='11111111-1111-4111-8111-111111111111') <> 500 then raise exception 'Count incorrect'; end if;
  begin
    insert into public.mcpos_device_commands(user_id,device_id,mcp_client_id,command,billing_plan,billing_verified_until) values ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','desktop.status','personal',now()+interval '75 seconds');
    raise exception 'Over-quota command accepted';
  exception when raise_exception then
    if sqlerrm <> 'mcpos_daily_command_limit' then raise; end if;
  end;
  if (public.claim_mcpos_device_command('ci-usage-device')->>'id') is distinct from '77777777-7777-4777-8777-777777777777' then raise exception 'Valid paid command not claimed'; end if;
  if not public.authorize_mcpos_device_command('ci-usage-device','77777777-7777-4777-8777-777777777777') then raise exception 'Valid grant rejected'; end if;
  update public.mcpos_device_commands set billing_verified_until=now()-interval '1 second' where id='77777777-7777-4777-8777-777777777777';
  if public.authorize_mcpos_device_command('ci-usage-device','77777777-7777-4777-8777-777777777777') then raise exception 'Expired grant authorized'; end if;
end $$;
-- Private beta and explicitly exempt accounts do not consume a paid quota.
insert into public.mcpos_device_commands(user_id,device_id,mcp_client_id,command) values ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','desktop.status');
do $$
begin
  if (select command_count from public.mcpos_daily_command_usage where user_id='11111111-1111-4111-8111-111111111111') <> 500 then raise exception 'Exempt command counted'; end if;
end $$;
rollback;
