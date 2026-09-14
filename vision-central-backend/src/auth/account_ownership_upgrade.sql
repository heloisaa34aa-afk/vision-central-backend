-- Vision Central: cada login possui seus próprios clientes, playlists e TVs.
-- Execute UMA VEZ depois de auth_admin_migration.sql.

alter table public.clientes
  add column if not exists owner_user_id uuid references auth.users(id) on delete restrict;

create index if not exists clientes_owner_user_id_idx
  on public.clientes(owner_user_id);

-- Preserva vínculos criados pela migração anterior.
update public.clientes c
set owner_user_id = p.id
from public.user_profiles p
where c.owner_user_id is null
  and p.cliente_id = c.id
  and p.role = 'client';

-- Clientes antigos sem dono passam para a primeira conta administradora ativa.
do $$
declare
  admin_id uuid;
begin
  select id into admin_id
  from public.user_profiles
  where role = 'admin' and status = 'active'
  order by created_at
  limit 1;

  if admin_id is not null then
    update public.clientes set owner_user_id = admin_id where owner_user_id is null;
  end if;
end;
$$;

create table if not exists public.account_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  max_screens integer not null default 1 check (max_screens > 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  status text not null default 'trial' check (status in ('trial', 'active', 'suspended', 'expired')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);

insert into public.account_subscriptions (user_id, max_screens, starts_at, status)
select
  p.id,
  case when p.role = 'admin' then greatest(10000, count(t.id)::integer) else greatest(1, count(t.id)::integer) end,
  now(),
  case when p.status = 'active' then 'active' else 'trial' end
from public.user_profiles p
left join public.clientes c on c.owner_user_id = p.id
left join public.tvs t on t.cliente_id = c.id
group by p.id, p.status, p.role
on conflict (user_id) do nothing;

update public.account_subscriptions a
set max_screens = greatest(a.max_screens, 10000), status = 'active', updated_at = now()
from public.user_profiles p
where p.id = a.user_id and p.role = 'admin';

alter table public.account_subscriptions enable row level security;

drop policy if exists "vision account plans select" on public.account_subscriptions;
create policy "vision account plans select" on public.account_subscriptions
for select to authenticated
using (user_id = auth.uid() or public.is_vision_admin());

drop policy if exists "vision account plans admin insert" on public.account_subscriptions;
create policy "vision account plans admin insert" on public.account_subscriptions
for insert to authenticated with check (public.is_vision_admin());

drop policy if exists "vision account plans admin update" on public.account_subscriptions;
create policy "vision account plans admin update" on public.account_subscriptions
for update to authenticated using (public.is_vision_admin()) with check (public.is_vision_admin());

drop policy if exists "vision account plans admin delete" on public.account_subscriptions;
create policy "vision account plans admin delete" on public.account_subscriptions
for delete to authenticated using (public.is_vision_admin());

grant select, insert, update, delete on public.account_subscriptions to authenticated;
grant all on public.account_subscriptions to service_role;

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

  insert into public.account_subscriptions (user_id, max_screens, starts_at, status)
  values (new.id, 1, now(), 'trial')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create or replace function public.set_vision_client_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_vision_admin() then
    new.owner_user_id := auth.uid();
  elsif new.owner_user_id is null and auth.uid() is not null then
    new.owner_user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists before_vision_client_owner on public.clientes;
create trigger before_vision_client_owner
  before insert on public.clientes
  for each row execute function public.set_vision_client_owner();

-- O plano antigo por estabelecimento deixa de ser criado.
drop trigger if exists on_vision_client_created on public.clientes;

create or replace function public.enforce_vision_screen_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  account_owner uuid;
  plan public.account_subscriptions%rowtype;
  used_count integer;
begin
  select owner_user_id into account_owner from public.clientes where id = new.cliente_id;
  if account_owner is null then
    raise exception 'Cliente sem conta proprietária.';
  end if;

  select * into plan from public.account_subscriptions where user_id = account_owner;
  if not found then
    raise exception 'Conta sem plano de telas configurado.';
  end if;
  if plan.status not in ('trial', 'active') then
    raise exception 'O plano desta conta não permite novas telas.';
  end if;
  if plan.ends_at is not null and plan.ends_at < now() then
    raise exception 'O plano desta conta expirou.';
  end if;

  select count(*) into used_count
  from public.tvs t
  join public.clientes c on c.id = t.cliente_id
  where c.owner_user_id = account_owner;

  if used_count >= plan.max_screens then
    raise exception 'Limite total de % tela(s) atingido para esta conta.', plan.max_screens;
  end if;
  return new;
end;
$$;

drop trigger if exists before_vision_tv_insert on public.tvs;
create trigger before_vision_tv_insert
  before insert on public.tvs
  for each row execute function public.enforce_vision_screen_limit();

-- O vínculo direto login -> cliente não é mais utilizado.
update public.user_profiles set cliente_id = null where cliente_id is not null;
