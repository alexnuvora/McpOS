-- Synthetic identities only. The inner subtransaction is always rolled back.
do $proof$
declare
  u uuid := gen_random_uuid();
  other_user uuid := gen_random_uuid();
  d uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  day_utc date := (now() at time zone 'UTC')::date;
  plan text;
  quota integer;
  n integer;
begin
  begin
    insert into auth.users(id) values(u),(other_user);
    insert into public.mcpos_devices(id,user_id,device_name,status) values(d,u,'Quota rollback fixture','online');
    insert into public.mcpos_mcp_clients(id,user_id,client_name,token_hash,scopes)
      values(c,u,'Quota rollback fixture',replace(gen_random_uuid()::text,'-',''),array['desktop.status']);
    set local role service_role;
    insert into public.mcpos_daily_command_usage(user_id,usage_date,command_count)
      values(u,day_utc,499),(u,day_utc-1,10000),(other_user,day_utc,17);
    for plan,quota in select * from (values ('personal',500),('professional',2000),('business',10000)) as limits(p,q) loop
      update public.mcpos_daily_command_usage set command_count=quota-1 where user_id=u and usage_date=day_utc;
      insert into public.mcpos_device_commands(user_id,device_id,mcp_client_id,command,billing_plan,billing_verified_until)
        values(u,d,c,'desktop.status',plan,now()+interval '75 seconds');
      select command_count into n from public.mcpos_daily_command_usage where user_id=u and usage_date=day_utc;
      if n is distinct from quota then raise exception 'Incorrect accepted quota for %',plan; end if;
      begin
        insert into public.mcpos_device_commands(user_id,device_id,mcp_client_id,command,billing_plan,billing_verified_until)
          values(u,d,c,'desktop.status',plan,now()+interval '75 seconds');
        raise exception 'Over-limit command accepted for %',plan;
      exception when raise_exception then
        if sqlerrm <> 'mcpos_daily_command_limit' then raise; end if;
      end;
      select command_count into n from public.mcpos_daily_command_usage where user_id=u and usage_date=day_utc;
      if n is distinct from quota then raise exception 'Rejected command changed usage'; end if;
    end loop;
    if (select count(*) from public.mcpos_device_commands where user_id=u) <> 3 then raise exception 'Unexpected queued command count'; end if;
    if (select command_count from public.mcpos_daily_command_usage where user_id=other_user and usage_date=day_utc) is distinct from 17 then raise exception 'Cross-account usage changed'; end if;
    if (select command_count from public.mcpos_daily_command_usage where user_id=u and usage_date=day_utc-1) is distinct from 10000 then raise exception 'Previous UTC day changed'; end if;
    raise exception using errcode='PZ001',message='fixture_rollback_success';
  exception when sqlstate 'PZ001' then
    if sqlerrm <> 'fixture_rollback_success' then raise; end if;
  end;
  if exists(select 1 from auth.users where id in (u,other_user))
    or exists(select 1 from public.mcpos_daily_command_usage where user_id in (u,other_user))
    or exists(select 1 from public.mcpos_device_commands where user_id=u)
    or exists(select 1 from public.mcpos_devices where id=d)
    or exists(select 1 from public.mcpos_mcp_clients where id=c)
    then raise exception 'Synthetic fixture rollback failed'; end if;
  raise notice 'Hosted quota proof: all three boundaries, UTC day isolation, account isolation and rollback passed';
end $proof$;
