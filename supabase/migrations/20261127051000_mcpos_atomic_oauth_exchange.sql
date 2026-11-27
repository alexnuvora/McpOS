-- Consume a code and issue both hashed credentials and audit in one transaction.
create or replace function public.exchange_mcpos_oauth_code(
  p_code_hash text, p_client_id text, p_user_id uuid, p_redirect_uri text,
  p_resource text, p_challenge text, p_access_hash text, p_refresh_hash text
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  auth_code public.mcpos_oauth_codes%rowtype;
  oauth_client public.mcpos_oauth_clients%rowtype;
  new_client_id uuid;
begin
  if p_code_hash is null or p_access_hash is null or p_refresh_hash is null
     or p_code_hash !~ '^[a-f0-9]{64}$' or p_access_hash !~ '^[a-f0-9]{64}$'
     or p_refresh_hash !~ '^[a-f0-9]{64}$'
     or p_code_hash = p_access_hash or p_code_hash = p_refresh_hash
     or p_access_hash = p_refresh_hash then return false; end if;
  select * into oauth_client from public.mcpos_oauth_clients
    where client_id = p_client_id and p_redirect_uri = any(redirect_uris)
    for key share;
  if not found then return false; end if;
  select * into auth_code from public.mcpos_oauth_codes
    where code_hash = p_code_hash and client_id = p_client_id
      and user_id = p_user_id and redirect_uri = p_redirect_uri
      and resource = p_resource and code_challenge = p_challenge
      and consumed_at is null and expires_at > now()
    for update;
  if not found then return false; end if;
  update public.mcpos_oauth_codes set consumed_at = now() where code_hash = auth_code.code_hash;
  insert into public.mcpos_mcp_clients(user_id,client_name,token_hash,token_expires_at,token_resource,scopes)
    values(auth_code.user_id,left(oauth_client.client_name,80),p_access_hash,now()+interval '1 hour',auth_code.resource,auth_code.scopes)
    returning id into new_client_id;
  insert into public.mcpos_oauth_refresh_tokens(token_hash,client_id,mcp_client_id,user_id,resource,scopes,expires_at)
    values(p_refresh_hash,auth_code.client_id,new_client_id,auth_code.user_id,auth_code.resource,auth_code.scopes,now()+interval '30 days');
  insert into public.mcpos_device_audit(user_id,event_type,outcome,metadata)
    values(auth_code.user_id,'mcp.oauth.token_issued','success',jsonb_build_object('client_name',oauth_client.client_name,'scopes',auth_code.scopes));
  return true;
end;
$$;
revoke all on function public.exchange_mcpos_oauth_code(text,text,uuid,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.exchange_mcpos_oauth_code(text,text,uuid,text,text,text,text,text) to service_role;
