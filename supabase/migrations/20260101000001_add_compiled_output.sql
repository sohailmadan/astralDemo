-- Store the validated compiled bundle alongside the raw source, so the Learn page serves
-- exactly what was already validated during generation rather than recompiling (identically,
-- since esbuild/Tailwind are deterministic, but wastefully) on every view.
alter table public.activities
  add column if not exists compiled_js text,
  add column if not exists compiled_css text;
