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
;
  if not found then return false; end if;

  -- Always acquire the MCP client lock before locking refresh tokens.
  select * into owner_client from public.mcpos_mcp_clients
    where id = old_token.mcp_client_id and user_id = old_token.user_id
      and revoked_at is null and token_resource = old_token.resource
      and old_token.scopes <@ scopes
    for update;
  if not found then return false; end if;

  select * into old_token from public.mcpos_oauth_refresh_tokens
    where token_hash = p_old_hash and client_id = p_client_id
      and user_id = p_user_id and resource = p_resource
      and mcp_client_id = owner_client.id
      and revoked_at is null and expires_at > now()
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
  insert into public.mcpos_device_audit (user_id,event_type,outcome,metadata)
    values (old_token.user_id,'mcp.oauth.token_refreshed','success',
      jsonb_build_object('client_id',old_token.client_id,'mcp_client_id',old_token.mcp_client_id));
  return true;
end;
$$;
revoke all on function public.rotate_mcpos_oauth_refresh(text,text,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.rotate_mcpos_oauth_refresh(text,text,uuid,text,text,text) to service_role;

-- Revoke both access and refresh credentials for a single OAuth connection.
-- Invalid, unbound and already revoked tokens are deliberately indistinguishable.
create function public.revoke_mcpos_oauth_session(p_token_hash text,p_client_id text) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  target_id uuid;
  owner_client public.mcpos_mcp_clients%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_client_id is null then return; end if;
  select r.mcp_client_id into target_id from public.mcpos_oauth_refresh_tokens r
    where r.token_hash=p_token_hash and r.client_id=p_client_id and r.revoked_at is null;
  if not found then
    select c.id into target_id from public.mcpos_mcp_clients c
      where c.token_hash=p_token_hash and c.revoked_at is null
        and exists(select 1 from public.mcpos_oauth_refresh_tokens r
          where r.mcp_client_id=c.id and r.user_id=c.user_id and r.client_id=p_client_id and r.resource=c.token_resource);
  end if;
  if target_id is null then return; end if;
  select * into owner_client from public.mcpos_mcp_clients where id=target_id and revoked_at is null for update;
  if not found then return; end if;
  -- Revalidate after locking; a concurrent rotation may have changed either credential.
  if not exists(select 1 from public.mcpos_oauth_refresh_tokens r
    where r.mcp_client_id=owner_client.id and r.user_id=owner_client.user_id and r.client_id=p_client_id
      and r.resource=owner_client.token_resource
      and (owner_client.token_hash=p_token_hash or (r.token_hash=p_token_hash and r.revoked_at is null))) then return; end if;
  update public.mcpos_mcp_clients set revoked_at=now() where id=owner_client.id;
  update public.mcpos_oauth_refresh_tokens set revoked_at=now()
    where mcp_client_id=owner_client.id and user_id=owner_client.user_id and revoked_at is null;
  insert into public.mcpos_device_audit(user_id,event_type,outcome,metadata)
    values(owner_client.user_id,'mcp.oauth.revoked','success',jsonb_build_object('client_id',p_client_id,'mcp_client_id',owner_client.id));
end;
$$;
revoke all on function public.revoke_mcpos_oauth_session(text,text) from public, anon, authenticated;
grant execute on function public.revoke_mcpos_oauth_session(text,text) to service_role;
