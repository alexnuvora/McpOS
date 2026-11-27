begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
insert into public.mcpos_oauth_clients(client_id,client_name,redirect_uris) values
('fixture-a','Fixture A',array['https://example.com/callback']),('fixture-b','Fixture B',array['https://example.com/callback']);
insert into public.mcpos_mcp_clients(id,user_id,client_name,token_hash,scopes,token_resource,token_expires_at) values
('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','Fixture A',repeat('a',64),array['workspace.read'],'https://example.com/mcp',now()+interval '1 hour'),
('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','Fixture B',repeat('b',64),array['workspace.read'],'https://example.com/mcp',now()+interval '1 hour'),
('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111','Static',repeat('c',64),array['workspace.read'],null,null);
insert into public.mcpos_oauth_refresh_tokens(token_hash,client_id,mcp_client_id,user_id,resource,scopes,expires_at,revoked_at) values
(repeat('d',64),'fixture-a','33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','https://example.com/mcp',array['workspace.read'],now()+interval '1 day',null),
(repeat('e',64),'fixture-b','44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','https://example.com/mcp',array['workspace.read'],now()+interval '1 day',null),
(repeat('f',64),'fixture-a','33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','https://example.com/mcp',array['workspace.read'],now()+interval '1 day',now());
do $$
begin
  if has_function_privilege('anon','public.revoke_mcpos_oauth_session(text,text)','EXECUTE') or has_function_privilege('authenticated','public.revoke_mcpos_oauth_session(text,text)','EXECUTE') then raise exception 'Public RPC access'; end if;
end $$;
set local role service_role;
do $$
begin
  perform public.revoke_mcpos_oauth_session(repeat('a',64),'fixture-b');
  perform public.revoke_mcpos_oauth_session(repeat('d',64),'fixture-b');
  perform public.revoke_mcpos_oauth_session(repeat('c',64),'fixture-a');
  perform public.revoke_mcpos_oauth_session(repeat('f',64),'fixture-a');
  if exists(select 1 from public.mcpos_mcp_clients where revoked_at is not null) then raise exception 'Wrong client, static key or stale token revoked a connection'; end if;
  perform public.revoke_mcpos_oauth_session(repeat('a',64),'fixture-a');
  perform public.revoke_mcpos_oauth_session(repeat('a',64),'fixture-a');
  if not exists(select 1 from public.mcpos_mcp_clients where token_hash=repeat('a',64) and revoked_at is not null) then raise exception 'Access token not revoked'; end if;
  if exists(select 1 from public.mcpos_oauth_refresh_tokens where client_id='fixture-a' and revoked_at is null) then raise exception 'Refresh credentials remain active'; end if;
  if exists(select 1 from public.mcpos_mcp_clients where token_hash in (repeat('b',64),repeat('c',64)) and revoked_at is not null) then raise exception 'Other connection affected'; end if;
  perform public.revoke_mcpos_oauth_session(repeat('e',64),'fixture-b');
  if not exists(select 1 from public.mcpos_mcp_clients where token_hash=repeat('b',64) and revoked_at is not null) then raise exception 'Refresh revocation left access active'; end if;
  if exists(select 1 from public.mcpos_oauth_refresh_tokens where revoked_at is null) then raise exception 'Refresh credential remains active'; end if;
  if public.rotate_mcpos_oauth_refresh(repeat('e',64),'fixture-b','22222222-2222-4222-8222-222222222222','https://example.com/mcp',repeat('1',64),repeat('2',64)) then raise exception 'Revoked session rotated'; end if;
end $$;
rollback;
