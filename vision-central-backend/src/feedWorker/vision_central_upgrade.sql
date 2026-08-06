-- Execute uma vez no Supabase SQL Editor antes de publicar esta versao.

create table if not exists public.instagram_connections (
  id uuid primary key default gen_random_uuid(),
  instagram_user_id text not null unique,
  username text not null,
  encrypted_access_token text not null,
  token_expires_at timestamptz,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'EXPIRED', 'REVOKED')),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.feed_sources
  add column if not exists instagram_connection_id uuid references public.instagram_connections(id) on delete set null;

create table if not exists public.feed_source_media (
  source_id uuid primary key references public.feed_sources(id) on delete cascade,
  midia_id uuid not null references public.midias(id) on delete cascade,
  instagram_item_id text not null,
  storage_path text,
  updated_at timestamptz not null default now()
);

alter table public.tvs
  add column if not exists config_revision bigint not null default 0;

alter table public.instagram_connections enable row level security;
alter table public.feed_source_media enable row level security;

-- Nenhum token do Instagram fica acessivel pelo navegador ou pelo APK.
revoke all on public.instagram_connections from anon, authenticated;
revoke all on public.feed_source_media from anon, authenticated;
grant all on public.instagram_connections to service_role;
grant all on public.feed_source_media to service_role;

create or replace function public.increment_tv_config_revision(p_tv_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.tvs
  set config_revision = coalesce(config_revision, 0) + 1,
      ultima_sincronizacao = now()
  where id = p_tv_id;
$$;

grant execute on function public.increment_tv_config_revision(uuid) to anon, authenticated, service_role;
