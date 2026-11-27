begin;
do $$
begin
  if has_function_privilege('anon','public.register_mcpos_oauth_client(text,text,text[])','EXECUTE') or has_function_privilege('authenticated','public.register_mcpos_oauth_client(text,text,text[])','EXECUTE') then raise exception 'Public RPC access'; end if;
  if has_table_privilege('anon','public.mcpos_oauth_registration_budget','SELECT') or has_table_privilege('authenticated','public.mcpos_oauth_registration_budget','UPDATE') then raise exception 'Budget exposed'; end if;
end $$;
set local role service_role;
insert into public.mcpos_oauth_registration_budget(singleton,minute_start,minute_count,day_start,day_count)
values(true,date_trunc('minute',clock_timestamp()),59,(clock_timestamp() at time zone 'UTC')::date,999);
do $$
begin
  if not public.register_mcpos_oauth_client('fixture-one','Fixture',array['https://example.com/callback']) then raise exception 'Last available registration rejected'; end if;
  if public.register_mcpos_oauth_client('fixture-two','Fixture',array['https://example.com/callback']) then raise exception 'Daily limit bypassed'; end if;
  if exists(select 1 from public.mcpos_oauth_clients where client_id='fixture-two') then raise exception 'Rejected client persisted'; end if;
  update public.mcpos_oauth_registration_budget set minute_start=date_trunc('minute',clock_timestamp()),minute_count=60,day_count=5;
  -- The minute boundary can roll during CI; the day limit test above is independent.
  if public.register_mcpos_oauth_client('fixture-three','Fixture',array['https://example.com/callback']) and (select minute_count from public.mcpos_oauth_registration_budget) <> 1 then raise exception 'Minute limit bypassed'; end if;
  update public.mcpos_oauth_registration_budget set minute_start=date_trunc('minute',clock_timestamp())-interval '1 minute',minute_count=60,day_count=10;
  if not public.register_mcpos_oauth_client('fixture-four','Fixture',array['https://example.com/callback']) then raise exception 'Minute reset failed'; end if;
  if (select day_count from public.mcpos_oauth_registration_budget) <> 11 then raise exception 'Minute reset erased daily usage'; end if;
  update public.mcpos_oauth_registration_budget set day_start=(clock_timestamp() at time zone 'UTC')::date-1,day_count=1000,minute_start=date_trunc('minute',clock_timestamp())-interval '1 day',minute_count=60;
  if not public.register_mcpos_oauth_client('fixture-five','Fixture',array['https://example.com/callback']) then raise exception 'Daily reset failed'; end if;
  if (select day_count from public.mcpos_oauth_registration_budget) <> 1 then raise exception 'Daily counter not reset'; end if;
end $$;
rollback;
