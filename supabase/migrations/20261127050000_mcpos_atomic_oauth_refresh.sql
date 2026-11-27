-- Atomic, service-only OAuth refresh rotation. No plaintext tokens enter the database.
create or replace function public.rotate_mcpos_oauth_refresh(
  p_old_hash text, p_client_id text, p_user_id uuid, p_resource text,
  p_access_hash text, p_refresh_hash text
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  old_token public.mcpos_oauth_refresh_tokens%rowtype;
  owner_client public.mcpos_mcp_clients%rowtype;
begin
  if p_old_hash is null or p_access_hash is null or p_refresh_hash is null
     or p_old_hash !~ '^[a-f0-9]{64}$' or p_access_hash !~ '^[a-f0-9]{64}$'
     or p_refresh_hash !~ '^[a-f0-9]{64}$'
     or p_old_hash = p_refresh_hash or p_old_hash = p_access_hash
     or p_access_hash = p_refresh_hash then return false; end if;

  select * into old_token from public.mcpos_oauth_refresh_tokens
    where token_hash = p_old_hash and client_id = p_client_id
      and user_id = p_user_id and resource = p_resource
      and revoked_at is null and expires_at > now()
    for update;
  if not found then return false; end if;

  select * into owner_client from public.mcpos_mcp_clients
    where id = old_token.mcp_client_id and user_id = old_token.user_id
      and revoked_at is null and token_resource = old_token.resource
      and old_token.scopes <@ scopes
    for update;
  if not found then return false; end if;

  update public.mcpos_oauth_refresh_tokens set revoked_at = now()
    where token_hash = old_token.token_hash;
  update public.mcpos_mcp_clients set
    token_hash = p_access_hash, token_expires_at = now() + interval '1 hour',
    last_used_at = now()
    where id = owner_client.id;
  insert into public.mcpos_oauth_refresh_tokens
    (token_hash, client_id, mcp_client_id, user_id, resource, scopes, expires_at)
  values (p_refresh_hash, old_token.client_id, old_token.mcp_client_id,
    old_token.user_id, old_token.resource, old_token.scopes, now() + interval '30 days');
  return true;
end;
$$;
revoke all on function public.rotate_mcpos_oauth_refresh(text,text,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.rotate_mcpos_oauth_refresh(text,text,uuid,text,text,text) to service_role;
