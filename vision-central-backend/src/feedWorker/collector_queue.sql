-- Execute uma vez no SQL Editor do Supabase antes de publicar o backend.
create table if not exists public.feed_jobs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.feed_sources(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  requested_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  lock_expires_at timestamptz,
  attempts integer not null default 0,
  completed_at timestamptz,
  error text,
  result_item_id text,
  created_at timestamptz not null default now()
);

create unique index if not exists feed_jobs_one_active_per_source
  on public.feed_jobs(source_id) where status in ('pending','processing');
create index if not exists feed_jobs_claim_idx
  on public.feed_jobs(status, available_at, requested_at);

alter table public.feed_jobs enable row level security;

create or replace function public.claim_feed_job(p_worker_id text, p_lock_seconds integer default 600)
returns setof public.feed_jobs
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  update public.feed_jobs
     set status='pending', locked_at=null, locked_by=null, lock_expires_at=null,
         available_at=now(), error='Reserva anterior expirou; tarefa devolvida a fila.'
   where status='processing' and lock_expires_at < now();

  select id into v_id
    from public.feed_jobs
   where status='pending' and available_at <= now()
   order by requested_at, created_at
   for update skip locked
   limit 1;

  if v_id is null then return; end if;
  return query
    update public.feed_jobs
       set status='processing', locked_at=now(), locked_by=p_worker_id,
           lock_expires_at=now() + make_interval(secs => greatest(60, least(p_lock_seconds, 3600))),
           attempts=attempts+1, error=null
     where id=v_id
     returning *;
end;
$$;

revoke all on function public.claim_feed_job(text, integer) from public, anon, authenticated;
grant execute on function public.claim_feed_job(text, integer) to service_role;

