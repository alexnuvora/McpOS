begin;
alter table public.mcpos_device_commands add column task_id uuid, add column task_step integer,
  add constraint mcpos_task_step_valid check ((task_id is null and task_step is null) or
    (task_id is not null and task_step is not null and task_step between 0 and 15));
create unique index mcpos_task_steps on public.mcpos_device_commands(task_id, task_step) where task_id is not null;
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
    and (q.task_step is null or q.task_step = 0 or exists (
      select 1 from public.mcpos_device_commands previous
      where previous.task_id = q.task_id and previous.task_step = q.task_step - 1
        and previous.status = 'completed' and previous.device_id = q.device_id
        and previous.mcp_client_id = q.mcp_client_id and previous.user_id = q.user_id
    ))
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

notify pgrst, 'reload schema';
commit;
