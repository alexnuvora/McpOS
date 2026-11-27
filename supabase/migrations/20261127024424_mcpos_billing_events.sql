-- Staged schema; apply to the McpOS development database only after review.
-- Use supabase migration new to generate a migration filename before deployment.
begin;
create table public.mcpos_billing_events (
  event_id text primary key check (event_id ~ '^evt_[A-Za-z0-9_]+$'),
  event_type text not null check (event_type in ('customer.subscription.created','customer.subscription.updated','customer.subscription.deleted')),
  event_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_subscription_id text not null check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  stripe_customer_id text not null check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_price_id text not null check (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  stripe_status text not null,
  current_period_end timestamptz,
  livemode boolean not null default false check (livemode = false)
);
create index mcpos_billing_events_user_subscription_idx on public.mcpos_billing_events (user_id, stripe_subscription_id, event_created_at desc);
alter table public.mcpos_billing_events enable row level security;
revoke all on public.mcpos_billing_events from public, anon, authenticated;
grant select, insert on public.mcpos_billing_events to service_role;
commit;
