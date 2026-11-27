-- Disposable CI database only.
begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
set local role service_role;
insert into public.mcpos_checkout_attempts(user_id,plan,price_id,customer_email,expires_at) values ('11111111-1111-4111-8111-111111111111','personal','price_ciPersonal','fixture@example.invalid',2000000000);
insert into public.mcpos_checkout_attempts(user_id,plan,price_id,customer_email,expires_at) values ('11111111-1111-4111-8111-111111111111','business','price_ciBusiness','fixture@example.invalid',2000000000) on conflict(user_id) do nothing;
insert into public.mcpos_checkout_attempts(user_id,plan,price_id,customer_email,expires_at) values ('22222222-2222-4222-8222-222222222222','business','price_ciBusiness','other@example.invalid',2000000000);
do $$
begin
  if (select count(*) from public.mcpos_checkout_attempts) <> 2 then raise exception 'Unexpected reservation count'; end if;
  if (select plan from public.mcpos_checkout_attempts where user_id='11111111-1111-4111-8111-111111111111') <> 'personal' then raise exception 'Existing attempt overwritten'; end if;
  delete from public.mcpos_checkout_attempts where user_id='11111111-1111-4111-8111-111111111111' and attempt_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if not found then null; else raise exception 'Wrong attempt removed'; end if;
end $$;
rollback;
