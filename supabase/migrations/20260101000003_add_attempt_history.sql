-- Records what happened on every generation attempt, not just the final one — the previous
-- schema only ever kept the last failure's error message and discarded its code entirely,
-- making a genuine repair-loop failure (as opposed to an interrupted/orphaned run) impossible
-- to diagnose after the fact. See CLAUDE.md "Generation: fixed contract".
alter table public.activities
  add column if not exists attempt_history jsonb not null default '[]'::jsonb;
-- Each entry: { attempt: number, code: string | null, error: string | null }.
-- code is null for a generation-call-level failure (timeout, unparseable model output) that
-- never produced code to inspect; error is null for the attempt that ultimately succeeded.
