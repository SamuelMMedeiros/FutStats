create table if not exists public.api_usage (
  day date primary key,
  count integer not null default 0 check (count >= 0)
);

create table if not exists public.matches_cache (
  cache_key text primary key,
  event_date date not null,
  payload jsonb not null,
  source text not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists matches_cache_event_date_idx on public.matches_cache(event_date);
create index if not exists matches_cache_expires_at_idx on public.matches_cache(expires_at);

create or replace function public.consume_api_football_request(p_day date, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare current_count integer;
begin
  insert into public.api_usage(day, count) values (p_day, 0)
  on conflict (day) do nothing;
  select count into current_count from public.api_usage where day = p_day for update;
  if current_count >= p_limit then return false; end if;
  update public.api_usage set count = current_count + 1 where day = p_day;
  return true;
end;
$$;

-- A função deve ser chamada pelo backend usando a chave de serviço.
revoke all on public.api_usage from anon, authenticated;
revoke all on public.matches_cache from anon, authenticated;
