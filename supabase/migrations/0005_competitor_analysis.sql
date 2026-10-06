alter table public.competitors add column if not exists analysis jsonb default '{}'::jsonb;
