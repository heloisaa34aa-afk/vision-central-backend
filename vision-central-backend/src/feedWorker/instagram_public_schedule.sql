-- Execute uma vez no SQL Editor do Supabase.
-- Mantem compatibilidade com fontes antigas e adiciona o horario diario.

alter table public.feed_sources
  add column if not exists horario_execucao time not null default '08:00:00',
  add column if not exists timezone text not null default 'America/Bahia';

update public.feed_sources
set
  horario_execucao = coalesce(horario_execucao, '08:00:00'::time),
  timezone = coalesce(nullif(timezone, ''), 'America/Bahia'),
  intervalo_horas = 24,
  proxima_execucao = null
where tipo = 'instagram';

create index if not exists feed_sources_due_idx
  on public.feed_sources (ativo, proxima_execucao)
  where ativo = true;

comment on column public.feed_sources.horario_execucao is
  'Horario local da consulta publica diaria do perfil.';
comment on column public.feed_sources.timezone is
  'Fuso IANA usado para calcular a proxima execucao, por exemplo America/Bahia.';
