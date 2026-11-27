-- Shared fixed-window limits for successful public OAuth registrations.
-- No IP addresses or user-supplied proxy headers are stored.
create table public.mcpos_oauth_registration_budget (
  singleton boolean primary key default true check(singleton),
  minute_start timestamptz not null,
  minute_count integer not null check(minute_count between 0 and 60),
  day_start date not null,
  day_count integer not null check(day_count between 0 and 1000)
);
alter table public.mcpos_oauth_registration_budget enable row level security;
revoke all on public.mcpos_oauth_registration_budget from public, anon, authenticated;
grant select, insert, update on public.mcpos_oauth_registration_budget to service_role;

create function public.register_mcpos_oauth_client(p_client_id text,p_client_name text,p_redirect_uris text[]) returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  minute_now timestamptz := date_trunc('minute',statement_timestamp());
  day_now date := (statement_timestamp() at time zone 'UTC')::date;
  budget public.mcpos_oauth_registration_budget%rowtype;
begin
  insert into public.mcpos_oauth_registration_budget(singleton,minute_start,minute_count,day_start,day_count)
    values(true,minute_now,0,day_now,0) on conflict(singleton) do nothing;
  select * into budget from public.mcpos_oauth_registration_budget where singleton for update;
  if budget.minute_start <> minute_now then budget.minute_count := 0; end if;
  if budget.day_start <> day_now then budget.day_count := 0; end if;
  if budget.minute_count >= 60 or budget.day_count >= 1000 then return false; end if;
  insert into public.mcpos_oauth_clients(client_id,client_name,redirect_uris)
    values(p_client_id,p_client_name,p_redirect_uris);
  update public.mcpos_oauth_registration_budget set minute_start=minute_now,minute_count=budget.minute_count+1,
    day_start=day_now,day_count=budget.day_count+1 where singleton;
  return true;
end;
$$;
revoke all on function public.register_mcpos_oauth_client(text,text,text[]) from public, anon, authenticated;
grant execute on function public.register_mcpos_oauth_client(text,text,text[]) to service_role;
