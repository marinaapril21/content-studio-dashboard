create table if not exists public.scrape_jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'starting',
  mode text not null,
  handles jsonb not null,
  cutoff timestamptz not null,
  run_id text,
  imported integer default 0,
  error text
);
alter table public.scrape_jobs enable row level security;
create unique index if not exists scrape_jobs_one_active
  on public.scrape_jobs ((true)) where status in ('starting', 'running');

-- Import and completion are atomic. Repeated polls preserve manual tags.
create or replace function public.finish_scrape(job_id uuid, posts jsonb)
returns integer language plpgsql security invoker set search_path = public as $$
declare j public.scrape_jobs; n integer;
begin
  select * into j from public.scrape_jobs where id = job_id for update;
  if not found then raise exception 'Unknown scrape job'; end if;
  if j.status = 'success' then return j.imported; end if;
  if j.status <> 'running' then raise exception 'Job is not running'; end if;
  insert into public.library_posts
    (source,type,posted_at,scraped_at,hook,caption,likes,comments,views,url,raw)
  select source,type,posted_at,now(),hook,caption,likes,comments,views,url,raw
  from jsonb_to_recordset(posts) as p(source text,type text,posted_at timestamptz,
    hook text,caption text,likes integer,comments integer,views integer,url text,raw jsonb)
  on conflict (url) where url is not null do update set
    source=excluded.source,type=excluded.type,posted_at=excluded.posted_at,
    scraped_at=excluded.scraped_at,hook=excluded.hook,caption=excluded.caption,
    likes=excluded.likes,comments=excluded.comments,views=excluded.views,raw=excluded.raw;
  get diagnostics n = row_count;
  update public.scrape_jobs set status='success', imported=n where id=job_id;
  insert into public.scrape_log(mode,status,duration_ms,notes)
    values(j.mode,'success',least(2147483647,extract(epoch from (now()-j.created_at))*1000)::integer,
      n::text || ' posts imported. 90-day window, max 300 posts per profile.');
  return n;
end $$;
revoke all on function public.finish_scrape(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.finish_scrape(uuid,jsonb) to service_role;
