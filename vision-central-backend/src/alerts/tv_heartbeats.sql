-- Otimizacao de presenca para dezenas de TVs.
-- Execute uma vez no SQL Editor do Supabase antes de instalar o novo APK.

begin;

alter table public.tvs
  add column if not exists config_revision bigint not null default 0;

create table if not exists public.tv_heartbeats (
  tv_id text primary key references public.tvs(id) on delete cascade,
  status text not null default 'Online' check (status in ('Online', 'Offline')),
  last_seen_at timestamptz not null default now(),
  uptime text,
  app_version text,
  updated_at timestamptz not null default now()
);

create index if not exists tv_heartbeats_last_seen_idx
  on public.tv_heartbeats (last_seen_at desc);

-- Preserva o ultimo estado conhecido durante a migracao.
insert into public.tv_heartbeats (tv_id, status, last_seen_at, uptime, updated_at)
select
  id,
  case when status = 'Online' then 'Online' else 'Offline' end,
  coalesce(ultima_conexao, now()),
  uptime,
  now()
from public.tvs
on conflict (tv_id) do nothing;

alter table public.tv_heartbeats enable row level security;

drop policy if exists "tv_heartbeats_select" on public.tv_heartbeats;
create policy "tv_heartbeats_select"
  on public.tv_heartbeats for select
  to anon, authenticated
  using (true);

drop policy if exists "tv_heartbeats_insert" on public.tv_heartbeats;
create policy "tv_heartbeats_insert"
  on public.tv_heartbeats for insert
  to anon, authenticated
  with check (exists (select 1 from public.tvs where id = tv_id));

drop policy if exists "tv_heartbeats_update" on public.tv_heartbeats;
create policy "tv_heartbeats_update"
  on public.tv_heartbeats for update
  to anon, authenticated
  using (exists (select 1 from public.tvs where id = tv_id))
  with check (exists (select 1 from public.tvs where id = tv_id));

grant select, insert, update on public.tv_heartbeats to anon, authenticated;

-- Compatibilidade durante a instalacao gradual: APKs antigos ainda escrevem
-- presenca em public.tvs. O gatilho copia somente essas atualizacoes para a
-- tabela nova; o APK otimizado escreve diretamente em tv_heartbeats.
create or replace function public.mirror_legacy_tv_heartbeat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tv_heartbeats (
    tv_id,
    status,
    last_seen_at,
    uptime,
    updated_at
  ) values (
    new.id,
    case when new.status = 'Online' then 'Online' else 'Offline' end,
    coalesce(new.ultima_conexao, now()),
    new.uptime,
    now()
  )
  on conflict (tv_id) do update set
    status = excluded.status,
    last_seen_at = excluded.last_seen_at,
    uptime = excluded.uptime,
    updated_at = excluded.updated_at;

  return new;
end;
$$;

drop trigger if exists tvs_mirror_legacy_heartbeat on public.tvs;
create trigger tvs_mirror_legacy_heartbeat
after update of status, ultima_conexao, uptime on public.tvs
for each row execute function public.mirror_legacy_tv_heartbeat();

-- Heartbeats nao devem produzir mensagens Realtime.
do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tv_heartbeats'
  ) then
    alter publication supabase_realtime drop table public.tv_heartbeats;
  end if;
end $$;

-- Toda mudanca de conteudo incrementa apenas as TVs ligadas a playlist afetada.
create or replace function public.bump_tvs_for_playlist_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_playlist text;
begin
  if tg_op = 'DELETE' then
    affected_playlist := old.playlist_id;
  else
    affected_playlist := new.playlist_id;
  end if;

  update public.tvs
  set config_revision = coalesce(config_revision, 0) + 1
  where playlist_id = affected_playlist;

  if tg_op = 'UPDATE' and old.playlist_id is distinct from new.playlist_id then
    update public.tvs
    set config_revision = coalesce(config_revision, 0) + 1
    where playlist_id = old.playlist_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists playlist_midias_bump_tv_revision on public.playlist_midias;
create trigger playlist_midias_bump_tv_revision
after insert or update or delete on public.playlist_midias
for each row execute function public.bump_tvs_for_playlist_change();

-- Quando uma midia muda (inclusive feed do Instagram), atualiza as TVs que a exibem.
create or replace function public.bump_tvs_for_media_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_media text;
begin
  if tg_op = 'DELETE' then
    affected_media := old.id;
  else
    affected_media := new.id;
  end if;

  update public.tvs
  set config_revision = coalesce(config_revision, 0) + 1
  where playlist_id in (
    select distinct pm.playlist_id
    from public.playlist_midias pm
    where pm.midia_id = affected_media
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists midias_bump_tv_revision on public.midias;
create trigger midias_bump_tv_revision
after update on public.midias
for each row execute function public.bump_tvs_for_media_change();

commit;
