begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
insert into public.mcpos_oauth_clients(client_id,client_name,redirect_uris) values ('fixture','Fixture',array['https://example.com/callback']);
insert into public.mcpos_mcp_clients(id,user_id,client_name,token_hash,scopes,token_resource,token_expires_at) values
('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','Fixture',repeat('a',64),array['workspace.read'],'https://example.com/mcp',now()+interval '1 hour');
insert into public.mcpos_oauth_refresh_tokens(token_hash,client_id,mcp_client_id,user_id,resource,scopes,expires_at) values
(repeat('b',64),'fixture','33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','https://example.com/mcp',array['workspace.read'],now()+interval '1 day');
do $$
begin
  if has_function_privilege('anon','public.rotate_mcpos_oauth_refresh(text,text,uuid,text,text,text)','EXECUTE') or has_function_privilege('authenticated','public.rotate_mcpos_oauth_refresh(text,text,uuid,text,text,text)','EXECUTE') then raise exception 'Public access'; end if;
end $$;
set local role service_role;
do $$
declare
  uid uuid := '11111111-1111-4111-8111-111111111111';
  resource text := 'https://example.com/mcp';
begin
  if public.rotate_mcpos_oauth_refresh(repeat('b',64),'wrong',uid,resource,repeat('c',64),repeat('d',64)) then raise exception 'Wrong client accepted'; end if;
  if public.rotate_mcpos_oauth_refresh(repeat('b',64),'fixture','22222222-2222-4222-8222-222222222222',resource,repeat('c',64),repeat('d',64)) then raise exception 'Wrong owner accepted'; end if;
  if public.rotate_mcpos_oauth_refresh(repeat('b',64),'fixture',uid,'https://wrong.invalid/mcp',repeat('c',64),repeat('d',64)) then raise exception 'Wrong resource accepted'; end if;
  if not public.rotate_mcpos_oauth_refresh(repeat('b',64),'fixture',uid,resource,repeat('c',64),repeat('d',64)) then raise exception 'Valid rotation rejected'; end if;
  if public.rotate_mcpos_oauth_refresh(repeat('b',64),'fixture',uid,resource,repeat('e',64),repeat('f',64)) then raise exception 'Replay accepted'; end if;
  -- A duplicate refresh hash forces rollback of all writes in the function.
  begin
    perform public.rotate_mcpos_oauth_refresh(repeat('d',64),'fixture',uid,resource,repeat('e',64),repeat('b',64));
    raise exception 'Collision unexpectedly accepted';
  exception when unique_violation then null;
  end;
  if not exists(select 1 from public.mcpos_oauth_refresh_tokens where token_hash=repeat('d',64) and revoked_at is null) then raise exception 'Old refresh lost on failed transaction'; end if;
  if not exists(select 1 from public.mcpos_mcp_clients where token_hash=repeat('c',64)) then raise exception 'Access key changed on failed transaction'; end if;
  update public.mcpos_mcp_clients set revoked_at=now() where id='33333333-3333-4333-8333-333333333333';
  if public.rotate_mcpos_oauth_refresh(repeat('d',64),'fixture',uid,resource,repeat('e',64),repeat('f',64)) then raise exception 'Revoked client accepted'; end if;
end $$;
rollback;
