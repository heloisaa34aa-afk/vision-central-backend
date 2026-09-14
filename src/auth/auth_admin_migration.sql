-- Vision Central: autenticação, perfis, planos e notificações por cliente.
-- Execute UMA VEZ no SQL Editor do Supabase antes de publicar o novo painel/backend.

create extension if not exists pgcrypto;

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  full_name text not null default '',
  role text not null default 'client' check (role in ('admin', 'client')),
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  cliente_id text references public.clientes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_profiles_cliente_id_idx on public.user_profiles(cliente_id);
create index if not exists user_profiles_role_status_idx on public.user_profiles(role, status);

create table if not exists public.client_subscriptions (
  cliente_id text primary key references public.clientes(id) on delete cascade,
  max_screens integer not null default 1 check (max_screens > 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  status text not null default 'trial' check (status in ('trial', 'active', 'suspended', 'expired')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);

insert into public.client_subscriptions (cliente_id, max_screens, starts_at, status)
select c.id, greatest(1, count(t.id)::integer), now(), 'active'
from public.clientes c
left join public.tvs t on t.cliente_id = c.id
group by c.id
on conflict (cliente_id) do nothing;

create or replace function public.handle_vision_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email, full_name, role, status)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', ''), 'client', 'pending')
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  return new;
end;
$$;

drop trigger if exists on_vision_auth_user_created on auth.users;
create trigger on_vision_auth_user_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_vision_user_created();

insert into public.user_profiles (id, email, full_name, role, status)
select id, coalesce(email, ''), coalesce(raw_user_meta_data ->> 'full_name', ''), 'client', 'pending'
from auth.users
on conflict (id) do nothing;

create or replace function public.is_vision_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

create or replace function public.current_vision_cliente_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select cliente_id from public.user_profiles
  where id = auth.uid() and status = 'active'
  limit 1;
$$;

alter table public.user_profiles enable row level security;
alter table public.client_subscriptions enable row level security;

drop policy if exists "vision profiles select" on public.user_profiles;
create policy "vision profiles select" on public.user_profiles
for select to authenticated
using (id = auth.uid() or public.is_vision_admin());

drop policy if exists "vision profiles admin update" on public.user_profiles;
create policy "vision profiles admin update" on public.user_profiles
for update to authenticated
using (public.is_vision_admin())
with check (public.is_vision_admin());

drop policy if exists "vision subscriptions select" on public.client_subscriptions;
create policy "vision subscriptions select" on public.client_subscriptions
for select to authenticated
using (public.is_vision_admin() or cliente_id = public.current_vision_cliente_id());

drop policy if exists "vision subscriptions admin insert" on public.client_subscriptions;
create policy "vision subscriptions admin insert" on public.client_subscriptions
for insert to authenticated with check (public.is_vision_admin());

drop policy if exists "vision subscriptions admin update" on public.client_subscriptions;
create policy "vision subscriptions admin update" on public.client_subscriptions
for update to authenticated using (public.is_vision_admin()) with check (public.is_vision_admin());

drop policy if exists "vision subscriptions admin delete" on public.client_subscriptions;
create policy "vision subscriptions admin delete" on public.client_subscriptions
for delete to authenticated using (public.is_vision_admin());

grant select on public.user_profiles to authenticated;
grant update on public.user_profiles to authenticated;
grant select, insert, update, delete on public.client_subscriptions to authenticated;
grant all on public.user_profiles, public.client_subscriptions to service_role;
grant execute on function public.is_vision_admin() to authenticated, service_role;
grant execute on function public.current_vision_cliente_id() to authenticated, service_role;

create or replace function public.ensure_client_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.client_subscriptions (cliente_id, max_screens, starts_at, status)
  values (new.id, 1, now(), 'trial')
  on conflict (cliente_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_vision_client_created on public.clientes;
create trigger on_vision_client_created
  after insert on public.clientes
  for each row execute function public.ensure_client_subscription();

create or replace function public.enforce_vision_screen_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  plan public.client_subscriptions%rowtype;
  used_count integer;
begin
  select * into plan from public.client_subscriptions where cliente_id = new.cliente_id;
  if not found then return new; end if;
  if plan.status not in ('trial', 'active') then
    raise exception 'Plano do cliente não permite novas telas.';
  end if;
  if plan.ends_at is not null and plan.ends_at < now() then
    raise exception 'Plano do cliente expirou.';
  end if;
  select count(*) into used_count from public.tvs where cliente_id = new.cliente_id;
  if used_count >= plan.max_screens then
    raise exception 'Limite de % tela(s) atingido para este cliente.', plan.max_screens;
  end if;
  return new;
end;
$$;

drop trigger if exists before_vision_tv_insert on public.tvs;
create trigger before_vision_tv_insert
  before insert on public.tvs
  for each row execute function public.enforce_vision_screen_limit();

-- Mantém esta migração executável mesmo se o SQL antigo de alertas não tiver sido rodado.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.push_subscriptions add column if not exists cliente_id text references public.clientes(id) on delete cascade;
alter table public.push_subscriptions add column if not exists role text check (role in ('admin', 'client'));
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);
create index if not exists push_subscriptions_cliente_id_idx on public.push_subscriptions(cliente_id);

-- PASSO FINAL: depois de criar sua conta pela nova tela de cadastro,
-- substitua o e-mail abaixo pelo seu e execute somente este UPDATE:
-- update public.user_profiles
-- set role = 'admin', status = 'active', cliente_id = null, updated_at = now()
-- where email = 'SEU_EMAIL_AQUI';
