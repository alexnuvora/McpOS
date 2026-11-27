-- Sandbox plan quota and time-bounded authorization on queued commands.
begin;
alter table public.mcpos_device_commands add column billing_plan text,
  add column billing_verified_until timestamptz,
  add constraint mcpos_command_billing_check check (
    (billing_plan is null and billing_verified_until is null)
    or (billing_plan is not null and billing_plan in ('personal','professional','business') and billing_verified_until is not null)
  );
create table public.mcpos_daily_command_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  command_count integer not null check (command_count > 0),
  primary key (user_id, usage_date)
);
alter table public.mcpos_daily_command_usage enable row level security;
revoke all on public.mcpos_daily_command_usage from public, anon, authenticated;
grant select, insert, update on public.mcpos_daily_command_usage to service_role;

create function public.mcpos_count_billable_command()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_limit integer;
  v_count integer;
begin
  if new.billing_plan is null then return new; end if;
  if new.billing_verified_until <= pg_catalog.now() or new.billing_verified_until > pg_catalog.now() + interval '90 seconds' then
    raise exception 'mcpos_billing_verification_expired' using errcode = 'P0001';
  end if;
  v_limit := case new.billing_plan when 'personal' then 500 when 'professional' then 2000 when 'business' then 10000 else 0 end;
  if v_limit = 0 then raise exception 'mcpos_invalid_plan'; end if;
  insert into public.mcpos_daily_command_usage as u(user_id, usage_date, command_count)
    values(new.user_id, (pg_catalog.now() at time zone 'UTC')::date, 1)
  on conflict (user_id, usage_date) do update set command_count = u.command_count + 1
    where u.command_count < v_limit
  returning command_count into v_count;
  if v_count is null then raise exception 'mcpos_daily_command_limit' using errcode = 'P0001'; end if;
  return new;
end;
$$;
revoke all on function public.mcpos_count_billable_command() from public, anon, authenticated;
grant execute on function public.mcpos_count_billable_command() to service_role;
create trigger mcpos_count_billable_command before insert on public.mcpos_device_commands
for each row execute function public.mcpos_count_billable_command();
create or replace function public.claim_mcpos_device_command(p_token_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_device_id uuid;
  v_user_id uuid;
  v_command public.mcpos_device_commands%rowtype;
begin
  select d.id, d.user_id into v_device_id, v_user_id
  from public.mcpos_device_credentials c
  join public.mcpos_devices d on d.id = c.device_id
  where c.token_hash = p_token_hash and c.revoked_at is null and d.status <> 'revoked' and d.revoked_at is null
  limit 1;
  if v_device_id is null then raise exception 'invalid_device_credential' using errcode = 'P0001'; end if;
  select * into v_command
  from public.mcpos_device_commands q
  where q.device_id = v_device_id and q.user_id = v_user_id and q.status = 'queued' and q.expires_at > pg_catalog.now() and (q.billing_verified_until is null or q.billing_verified_until > pg_catalog.now())
    and exists (
      select 1 from public.mcpos_mcp_clients m
      where m.id = q.mcp_client_id and m.user_id = q.user_id
        and m.revoked_at is null
        and (m.token_expires_at is null or m.token_expires_at > pg_catalog.now())
        and (case
          when q.command = 'desktop.status' then 'desktop.status'
          when q.command = 'screen.capture' then 'screen.capture'
          when q.command = 'desktop.accessibility' then 'screen.accessibility'
          when q.command in ('files.list','files.read') then 'files.read'
          when q.command in ('input.pointer.click','input.pointer.move','input.pointer.scroll') then 'input.pointer'
          when q.command in ('input.keyboard.type','input.keyboard.shortcut') then 'input.keyboard'
          when q.command in ('browser.open','browser.snapshot','browser.click','browser.type') then 'browser.control'
          else null
        end) = any(m.scopes)
    )
  order by q.created_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.mcpos_device_commands set status = 'claimed', claimed_at = pg_catalog.now() where id = v_command.id;
  return pg_catalog.jsonb_build_object('id',v_command.id,'command',v_command.command,'payload',v_command.payload,'expires_at',v_command.expires_at);
end;
$$;

create or replace function public.authorize_mcpos_device_command(p_token_hash text, p_command_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_device_id uuid;
  v_user_id uuid;
begin
  select d.id, d.user_id into v_device_id, v_user_id
  from public.mcpos_device_credentials c
  join public.mcpos_devices d on d.id = c.device_id
  where c.token_hash = p_token_hash and c.revoked_at is null and d.status <> 'revoked' and d.revoked_at is null
  limit 1;
  if v_device_id is null then raise exception 'invalid_device_credential' using errcode = 'P0001'; end if;
  return exists (
    select 1 from public.mcpos_device_commands q
    where q.id = p_command_id and q.device_id = v_device_id and q.user_id = v_user_id and q.status = 'claimed' and q.expires_at > pg_catalog.now() and (q.billing_verified_until is null or q.billing_verified_until > pg_catalog.now())
      and exists (
      select 1 from public.mcpos_mcp_clients m
      where m.id = q.mcp_client_id and m.user_id = q.user_id
        and m.revoked_at is null
        and (m.token_expires_at is null or m.token_expires_at > pg_catalog.now())
        and (case
          when q.command = 'desktop.status' then 'desktop.status'
          when q.command = 'screen.capture' then 'screen.capture'
          when q.command = 'desktop.accessibility' then 'screen.accessibility'
          when q.command in ('files.list','files.read') then 'files.read'
          when q.command in ('input.pointer.click','input.pointer.move','input.pointer.scroll') then 'input.pointer'
          when q.command in ('input.keyboard.type','input.keyboard.shortcut') then 'input.keyboard'
          when q.command in ('browser.open','browser.snapshot','browser.click','browser.type') then 'browser.control'
          else null
        end) = any(m.scopes)
    )
  );
end;
$$;

revoke all on function public.claim_mcpos_device_command(text) from public, anon, authenticated;
revoke all on function public.authorize_mcpos_device_command(text,uuid) from public, anon, authenticated;
grant execute on function public.claim_mcpos_device_command(text) to service_role;
grant execute on function public.authorize_mcpos_device_command(text,uuid) to service_role;


commit;
