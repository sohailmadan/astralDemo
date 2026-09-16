# Generative Interactive Learning

A two-page app: describe what you want to learn, get back a real, generated, interactive
piece of software to learn it with — not an article, not a static quiz — alongside an AI
tutor that can see and act on the activity's live state.

Built for a take-home challenge. See `CLAUDE.md` for the detailed architecture/reliability
record kept up to date as the project progressed.

**Status**: Milestones 1–3 (app skeleton, generation pipeline, AI tutor) complete and working.
Milestone 4 (polish) in progress. **Deployed to Vercel + Supabase production**:
https://astral-challenge-lilac.vercel.app — verified end-to-end there (a real generation
request, compiled and rendered, with a working tutor chat), not just a successful build. Env
vars are set as real Vercel Project settings (`vercel env add`), not passed per-deploy — a
plain `vercel deploy --prod` redeploys cleanly with no flags needed. The GitHub repo is
connected to the Vercel project, so a push to `main` auto-deploys without a manual CLI step.
On the Hobby plan, so
`/api/generate`'s `maxDuration` is capped at 300s (see "Tradeoffs" below) rather than the 800s a
Pro plan would allow. Sample Langfuse trace + access grant to
shivam@astraltutor.com not yet done.

## Architecture

```
app/
  page.tsx                        Generate page (/)
  activities/[id]/page.tsx        Learn page
  api/generate/route.ts           generate -> validate -> repair pipeline
  api/tutor/route.ts              tutor context assembly + tool-calling turn
  api/activities/[id]/events/route.ts          state/event persistence + progress reset
  api/activities/[id]/tutor-messages/route.ts  chat transcript persistence
lib/
  ai/
    openrouter.ts                 provider access point (OpenRouter + OpenAI escalation)
    generateActivity.ts           generation call: schema, system prompt, repair support
    tutor.ts                      tutor context assembly + tool-calling turn
  validate/
    compile.ts                    esbuild + Tailwind JIT compile/validate
    iframe-html.ts                sandboxed iframe srcDoc (incl. initialState injection)
  supabase/                       client.ts, server.ts, service.ts, queries.ts
  generation-constants.ts         retry/timeout constants shared by pipeline + UI
  trace.ts                        Langfuse tracing (direct HTTP client)
components/
  generate/                       Generate page UI
  activity/                       Learn page: iframe host, tutor chat, error boundary
  ui/                             shadcn primitives
sdk/
  activity-sdk.ts                 useTutorBridge() hook, bundled into every generated activity
  types.ts                        fixed contract types + host<->activity message protocol
evals/                            promptfoo suites (generation + tutor) against the real pipelines
supabase/migrations/              schema, RLS, Realtime publication
```

Everything reachable from the browser is a Server Component doing a plain read, or a Client
Component talking to our own `/api/*` routes — nothing in the browser holds privileged keys.

## How generation works

`POST /api/generate` inserts a row and returns immediately, then keeps working via Next's
`after()`. Up to 3 attempts:

1. **Generate** — `generateObject` against a Zod schema (`{ title, code, actions }`). The
   system prompt is deliberately short — see CLAUDE.md "Reliability" for why a long,
   heavily-qualified prompt measurably hurt compliance on the one rule that gates everything
   (every declared action actually being registered). It only encodes the mechanical contract:
   fixed imports, `useTutorBridge()`/`publishState`/`emitEvent`/`registerAction`, an optional
   `initialState` prop to resume from, no `<form>` (the sandbox has no `allow-forms`, so a
   submit silently kills the click handler), and real submit/feedback/hint affordances.
2. **Validate** — `compileActivity()` bundles with esbuild and JIT-compiles a scoped Tailwind
   stylesheet from only the classes actually used.
3. **Repair, if needed** — a compile failure or an unregistered declared action feeds the exact
   error back for a fix-only-what's-broken retry. Up to 2 repairs.
4. **Store or fail honestly** — success stores the validated compiled JS/CSS; exhausting all 3
   attempts writes `status: failed` with the real error.

**Model choice**: free OpenRouter models proved unreliable enough in practice (see CLAUDE.md
"Reliability") that codegen and tutor now default to paid OpenAI models via an escalation in
`lib/ai/openrouter.ts` (`USE_OPENAI_CODEGEN`/`USE_OPENAI_TUTOR`) — `gpt-5-mini` for codegen
(more reliable at genuinely decomposing a multi-step process, ~30-60s/call), `gpt-4o-mini` for
the tutor (fast). The free-tier OpenRouter path still exists as the default otherwise.

## How the AI tutor works

`POST /api/tutor` (`lib/ai/tutor.ts`) rebuilds context every turn: the activity's `last_state`
verbatim (must include the current step's actual question text, not just an index, or hints
answer the wrong step), a plain-language progress summary aggregated from `activity_events`,
and `tools` built from the activity's own registered `actions` (Zod-validated before any tool
call can reach the sandboxed iframe). `TutorChat` posts the reply and forwards any action call
to `ActivityFrame` to invoke inside the iframe. A generated activity's "Need a hint?" only ever
emits a `hint_requested` event — `ActivityWorkspace` turns that into a real tutor turn.

## How generated code is validated and executed

- **Validated** server-side by esbuild (transforms/bundles syntax, never executes it).
- **Executed** in a sandboxed iframe: inlined `srcDoc`, `sandbox="allow-scripts"` only (no
  `allow-same-origin`, no `allow-forms` — hence the no-`<form>` rule above), and a CSP
  (`default-src 'none'`) blocking all network access.
- **Resuming state**: a returning learner's `last_state` is injected as a `window` global in a
  `<script>` tag before the compiled bundle runs, read once at mount as the `initialState` prop.
- **Hang protection**: a 5s handshake timeout treats a non-responding iframe as hung.
- **Pre-flight validation**: the sandboxed render itself must succeed before status becomes
  `ready` — compiling isn't the same as working.

## Observability

Langfuse via a direct HTTP client (`lib/trace.ts`) — chosen after three different
OpenTelemetry-based wiring attempts (`ai` SDK telemetry, `@langfuse/otel`, a manual
`NodeTracerProvider`) never produced a verifiable trace; `ai@7`'s telemetry system is
incompatible with Langfuse's current OTel packages. Every generation attempt and tutor turn is
captured (full prompt, response, model, latency, tokens); compile failures are captured
separately as events since they happen outside any AI SDK call. No keys set → tracing is
skipped, not a failure. **Not yet done**: sharing a sample trace + access with
shivam@astraltutor.com.

## Tradeoffs made

- **`after()`, not a durable queue** — a killed function loses that generation with no retry.
  Acceptable at this scale; wrong under real traffic (a proper queue/worker would be correct).
- **No auth**, per the brief — RLS deny-by-default instead; all writes go through server routes
  using the service-role key.
- **Store the compiled bundle**, not just source — the Learn page serves what was validated.
- **A static worst-case time estimate**, not a live percentage — "attempt X of 3" is exact;
  "up to 6 minutes" is derived from real pipeline constants.
- **A short, mechanical-contract-only prompt**, not an exhaustive rulebook — several rounds of
  live testing showed a long prompt with pedagogical essays and per-bug patches measurably hurt
  compliance, likely by diluting attention. Kept only rules verified to matter and generalize.
- **Paid OpenAI models over free OpenRouter, by default** — a deliberate reversal after live
  testing showed free models' failure rate too high to build against reliably.
- **`maxDuration = 300`, not the 800 a Pro plan allows** — the real Hobby-plan ceiling
  (confirmed by a rejected deploy, not guessed). Slightly under the pipeline's own theoretical
  6-minute worst case if every attempt needs a repair; the typical case (tens of seconds) is
  comfortably under it. Three deploy-only bugs surfaced fixing this (see the commit that added
  this line): esbuild couldn't resolve react/react-dom/scheduler at runtime because Next's
  file-tracing can't see a resolution that happens inside a template string, and
  `NEXT_PUBLIC_*` vars needed to be build-time env, not just runtime — none of this was
  reachable by "the local production build works."

## What I'd improve with more time

- Share a sample Langfuse trace + grant shivam@astraltutor.com access.
- Smaller, more frequent commits — a full session's fixes accumulated uncommitted before being
  swept into a handful of larger commits.
- Continue Milestone 4's visual/interaction polish on generated activities specifically.
- Replace `after()` with a real queue/worker for production traffic.
- A server-side sweep to flip stuck `generating` rows to `failed` (currently client-UI-only).
- Broaden eval coverage, and add a repair-loop-aware eval mode (the current suites call
  generation/tutor once each, not through the real 3-attempt retry loop `/api/generate` uses).
- Fish Audio voice on the tutor chat (explicit stretch goal, deferred behind text-first tutor).

## Developer guide

**Mental model**: a learning request produces a *fixed-contract* React component (not free-form
code, not lesson text) that a tiny SDK (`sdk/activity-sdk.ts`) wires to an AI tutor. The
component owns its own UI/state; it only ever talks outward through three calls
(`publishState`/`emitEvent`/`registerAction`). The tutor never sees the rendered screen — only
whatever the activity chooses to `publishState`. Everything else (compiling, sandboxing,
persistence, retries) exists to make that one narrow contract safe and reliable, not to add
features to it.

**Adding a new rule to what's generated**: edit `SYSTEM_PROMPT` in `lib/ai/generateActivity.ts`
(activities) or `SYSTEM_PROMPT_HEADER` in `lib/ai/tutor.ts` (tutor replies). Keep additions
general — verified in this project that a long prompt full of per-bug patches measurably hurts
compliance (see "Tradeoffs" above). After any change: `bun run eval:generation` /
`eval:generation` or `eval:tutor` to check it didn't regress, then rebuild (see restart note
below) to see it live.

**Adding a new eval case**: add a `vars`/`assert` entry to `evals/generation.eval.yaml` or
`evals/tutor.eval.yaml`. `run-generation.ts`/`run-tutor.ts` call the real pipeline functions
directly — no mocking, so a new case is just a new prompt or fixture.

**Adding a new API route or DB column**: routes live in `app/api/**/route.ts`; new tables/
columns are a new file in `supabase/migrations/`, applied with `supabase db push`.

**Changing the LLM**: everything routes through `lib/ai/openrouter.ts` — never call
OpenRouter/OpenAI directly from elsewhere. To swap the free-tier default, edit `CODEGEN_MODEL`/
`TUTOR_MODEL` there. To use paid OpenAI models instead (recommended — see "Tradeoffs"), set in
`.env.local`: `USE_OPENAI_CODEGEN=true` + `OPENAI_CODEGEN_MODEL=<model>`, and/or
`USE_OPENAI_TUTOR=true` + `OPENAI_TUTOR_MODEL=<model>`.

**When you need to restart the server**: depends on how it's running.
- `bun run dev` (development) — hot-reloads automatically. Save a file, the next request picks
  it up. No restart needed for prompt/UI/route changes.
- `bun run start` (production build) — does **not** hot-reload. Any server-side change
  (`lib/ai/*`, `app/api/*`, the SDK, anything `generateActivity.ts`/`tutor.ts` import) needs a
  full rebuild + restart to take effect:
  ```bash
  lsof -ti:3000 -sTCP:LISTEN | xargs -r kill   # stop
  bun run build                                 # rebuild
  bun run start &                               # restart
  ```
  If you're iterating on the prompt or any server code, prefer `bun run dev` — it removes this
  step entirely.

## How to run locally

Requires [Bun](https://bun.sh), a Supabase project, and an OpenRouter API key (an OpenAI key
too, for the more reliable paid-model escalation above).

```bash
bun install
cp .env.example .env.local   # fill in Supabase + OpenRouter (+ optional OpenAI/Langfuse) values
supabase link --project-ref <your-project-ref>
supabase db push

bun run dev                # http://localhost:3000, hot-reloads on save
bun run test                # unit tests — no LLM calls
bun run eval:generation     # promptfoo vs. the real generation pipeline — real LLM calls
bun run eval:tutor          # promptfoo vs. the real tutor pipeline — real LLM calls
```

`.env.local` (see `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only),
`OPENROUTER_API_KEY`, optionally `OPENAI_API_KEY` + `USE_OPENAI_CODEGEN`/`USE_OPENAI_TUTOR`,
optionally `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`/`LANGFUSE_BASE_URL`.
