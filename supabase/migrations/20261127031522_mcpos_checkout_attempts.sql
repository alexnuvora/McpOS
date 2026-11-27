-- One sandbox checkout attempt per account, independent of selected plan.
begin;
create table public.mcpos_checkout_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  attempt_id uuid not null unique default gen_random_uuid(),
  plan text not null check (plan in ('personal','professional','business')),
  price_id text not null check (price_id ~ '^price_[A-Za-z0-9]+$'),
  customer_email text not null,
  created_at timestamptz not null default now(),
  expires_at bigint not null,
  stripe_session_id text unique check (stripe_session_id ~ '^cs_test_[A-Za-z0-9]+$')
);
alter table public.mcpos_checkout_attempts enable row level security;
revoke all on public.mcpos_checkout_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.mcpos_checkout_attempts to service_role;
commit;
