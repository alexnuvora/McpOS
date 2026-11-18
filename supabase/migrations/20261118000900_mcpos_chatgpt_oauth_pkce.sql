-- OAuth 2.1 authorization-code + PKCE support for ChatGPT custom MCP connectors.
-- Tokens are opaque, random, short-lived and stored only as SHA-256 hashes.

alter table public.mcpos_mcp_clients
  add column if not exists token_expires_at timestamptz;
alter table public.mcpos_mcp_clients
  add column if not exists token_resource text;

create table if not exists public.mcpos_oauth_clients (
  client_id text primary key,
  client_name text not null check (char_length(client_name) between 1 and 120),
  redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 20),
  grant_types text[] not null default array['authorization_code','refresh_token']::text[],
  response_types text[] not null default array['code']::text[],
  token_endpoint_auth_method text not null default 'none' check (token_endpoint_auth_method = 'none'),
  created_at timestamptz not null default now()
);
create table if not exists public.mcpos_oauth_codes (
  code_hash text primary key,
  client_id text not null references public.mcpos_oauth_clients(client_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  resource text not null,
  scopes text[] not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mcpos_oauth_codes_expiry_idx on public.mcpos_oauth_codes(expires_at);
create table if not exists public.mcpos_oauth_refresh_tokens (
  token_hash text primary key,
  client_id text not null references public.mcpos_oauth_clients(client_id) on delete cascade,
  mcp_client_id uuid not null references public.mcpos_mcp_clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  resource text not null,
  scopes text[] not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mcpos_oauth_refresh_client_idx on public.mcpos_oauth_refresh_tokens(mcp_client_id);
alter table public.mcpos_oauth_clients enable row level security;
alter table public.mcpos_oauth_codes enable row level security;
alter table public.mcpos_oauth_refresh_tokens enable row level security;
revoke all on public.mcpos_oauth_clients, public.mcpos_oauth_codes, public.mcpos_oauth_refresh_tokens from anon, authenticated;
grant all on public.mcpos_oauth_clients, public.mcpos_oauth_codes, public.mcpos_oauth_refresh_tokens to service_role;
