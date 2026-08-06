create extension if not exists pgcrypto;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tv_alert_state (
  tv_id text primary key,
  is_offline boolean not null default false,
  last_change timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.alert_events (
  id uuid primary key default gen_random_uuid(),
  tv_id text not null,
  cliente_id text,
  tipo text not null check (tipo in ('offline', 'recovered')),
  titulo text not null,
  mensagem text not null,
  criado_em timestamptz not null default now()
);

create index if not exists alert_events_criado_em_idx
  on public.alert_events (criado_em desc);

alter table public.push_subscriptions enable row level security;
alter table public.tv_alert_state enable row level security;
alter table public.alert_events enable row level security;

-- Não criar políticas públicas: somente o backend com SERVICE_ROLE acessa estas tabelas.
