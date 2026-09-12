-- Exposes which attempt the generation pipeline is currently on (1 = initial, 2/3 = repair
-- retries), so the UI can show real progress instead of an undifferentiated spinner. Read via
-- the same Realtime subscription already watching this table — no new plumbing needed.
alter table public.activities
  add column if not exists generation_attempt integer not null default 0;
