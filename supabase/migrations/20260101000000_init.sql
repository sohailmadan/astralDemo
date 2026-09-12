-- Astral take-home schema.
-- See CLAUDE.md "AI tutor <-> activity interface" and "Security considerations" for why the
-- three tables and RLS policies are shaped exactly this way.

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  prompt text not null,
  status text not null default 'generating'
    check (status in ('generating', 'ready', 'failed')),
  title text,
  code text,
  actions jsonb not null default '[]'::jsonb, -- [{ name, description }] from generation
  last_state jsonb,                            -- latest STATE_SNAPSHOT payload
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tutor_messages (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  action_call jsonb, -- { name, args } when the assistant turn included a tool call
  created_at timestamptz not null default now()
);

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  type text not null, -- e.g. answer_submitted, hint_requested, point_moved, step_completed
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tutor_messages_activity_id_idx
  on public.tutor_messages (activity_id, created_at);
create index if not exists activity_events_activity_id_idx
  on public.activity_events (activity_id, created_at);
create index if not exists activity_events_type_idx
  on public.activity_events (activity_id, type);

-- updated_at maintenance, so every write to a row (including the eventual status flip to
-- ready/failed) keeps this accurate without every call site remembering to set it.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger activities_set_updated_at
  before update on public.activities
  for each row
  execute function public.set_updated_at();

-- RLS: deny by default, expose only what the browser genuinely needs directly.
-- All writes and all tutor_messages/activity_events reads go through server routes using the
-- service-role key (which bypasses RLS by design) — see lib/supabase/service.ts.
alter table public.activities enable row level security;
alter table public.tutor_messages enable row level security;
alter table public.activity_events enable row level security;

-- The only public policy in this schema: the browser's Realtime subscription and the Generate
-- page's list both need to read activities directly.
create policy "anon can read activities"
  on public.activities
  for select
  to anon
  using (true);

-- Deliberately no policies on tutor_messages or activity_events for anon/authenticated —
-- Postgres denies all access by default once RLS is enabled with zero matching policies.

-- Realtime: only activities needs to push changes to the browser (see CLAUDE.md
-- "Persistence & no-manual-refresh requirement" for why tutor_messages/activity_events don't).
alter publication supabase_realtime add table public.activities;
