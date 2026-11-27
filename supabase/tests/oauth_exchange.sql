begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
insert into public.mcpos_oauth_clients(client_id,client_name,redirect_uris) values ('fixture','Fixture',array['https://example.com/callback']);
insert into public.mcpos_oauth_codes(code_hash,client_id,user_id,redirect_uri,code_challenge,resource,scopes,expires_at) values
(repeat('a',64),'fixture','11111111-1111-4111-8111-111111111111','https://example.com/callback','fixture-challenge','https://example.com/mcp',array['workspace.read'],now()+interval '5 minutes'),
(repeat('b',64),'fixture','11111111-1111-4111-8111-111111111111','https://example.com/callback','fixture-challenge','https://example.com/mcp',array['workspace.read'],now()+interval '5 minutes'),
(repeat('c',64),'fixture','11111111-1111-4111-8111-111111111111','https://example.com/callback','fixture-challenge','https://example.com/mcp',array['workspace.read'],now() - interval '1 minute');
do $$
begin
  if has_function_privilege('anon','public.exchange_mcpos_oauth_code(text,text,uuid,text,text,text,text,text)','EXECUTE') or has_function_privilege('authenticated','public.exchange_mcpos_oauth_code(text,text,uuid,text,text,text,text,text)','EXECUTE') then raise exception 'Public access'; end if;
end $$;
set local role service_role;
do $$
declare
  uid uuid := '11111111-1111-4111-8111-111111111111';
  uri text := 'https://example.com/callback';
  resource text := 'https://example.com/mcp';
  challenge text := 'fixture-challenge';
begin
  if public.exchange_mcpos_oauth_code(repeat('a',64),'wrong',uid,uri,resource,challenge,repeat('d',64),repeat('e',64)) then raise exception 'Wrong client accepted'; end if;
  if public.exchange_mcpos_oauth_code(repeat('a',64),'fixture','22222222-2222-4222-8222-222222222222',uri,resource,challenge,repeat('d',64),repeat('e',64)) then raise exception 'Wrong owner accepted'; end if;
  if public.exchange_mcpos_oauth_code(repeat('a',64),'fixture',uid,'https://wrong.invalid/callback',resource,challenge,repeat('d',64),repeat('e',64)) then raise exception 'Wrong redirect accepted'; end if;
  if public.exchange_mcpos_oauth_code(repeat('a',64),'fixture',uid,uri,'https://wrong.invalid/mcp',challenge,repeat('d',64),repeat('e',64)) then raise exception 'Wrong resource accepted'; end if;
  if public.exchange_mcpos_oauth_code(repeat('a',64),'fixture',uid,uri,resource,'wrong',repeat('d',64),repeat('e',64)) then raise exception 'Wrong PKCE accepted'; end if;
  if public.exchange_mcpos_oauth_code(repeat('c',64),'fixture',uid,uri,resource,challenge,repeat('d',64),repeat('e',64)) then raise exception 'Expired code accepted'; end if;
  if not public.exchange_mcpos_oauth_code(repeat('a',64),'fixture',uid,uri,resource,challenge,repeat('d',64),repeat('e',64)) then raise exception 'Valid code rejected'; end if;
  if public.exchange_mcpos_oauth_code(repeat('a',64),'fixture',uid,uri,resource,challenge,repeat('f',64),repeat('0',64)) then raise exception 'Replay accepted'; end if;
  if not exists(select 1 from public.mcpos_oauth_refresh_tokens r join public.mcpos_mcp_clients c on c.id=r.mcp_client_id where r.token_hash=repeat('e',64) and c.token_hash=repeat('d',64) and c.user_id=uid) then raise exception 'Credentials not bound'; end if;
  begin
    perform public.exchange_mcpos_oauth_code(repeat('b',64),'fixture',uid,uri,resource,challenge,repeat('f',64),repeat('e',64));
    raise exception 'Collision accepted';
  exception when unique_violation then null;
  end;
  if not exists(select 1 from public.mcpos_oauth_codes where code_hash=repeat('b',64) and consumed_at is null) then raise exception 'Code consumed on failure'; end if;
  if exists(select 1 from public.mcpos_mcp_clients where token_hash=repeat('f',64)) then raise exception 'Orphan access credential'; end if;
  if not public.exchange_mcpos_oauth_code(repeat('b',64),'fixture',uid,uri,resource,challenge,repeat('f',64),repeat('0',64)) then raise exception 'Retry after rollback failed'; end if;
end $$;
rollback;
