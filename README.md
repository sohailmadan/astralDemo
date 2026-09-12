# Generative Interactive Learning

A two-page app: describe what you want to learn, get back a real, generated, interactive
piece of software to learn it with — not an article, not a static quiz — alongside an AI
tutor that can see and act on the activity's live state.

Built for a take-home challenge. See `CLAUDE.md` for the full, detailed architecture record
kept up to date as the project progressed — this README is the required overview; `CLAUDE.md`
is the "why," including live findings from testing against real free-tier models.

**Status**: Milestones 1 and 2 (app skeleton, real generation pipeline) are complete and
verified against a live deployment. Milestone 3 (the AI tutor) is in progress — see
"What's not built yet" below.

## Architecture

```
app/
  page.tsx                     Generate page (/)
  activities/[id]/page.tsx     Learn page
  api/generate/route.ts        generate -> validate -> repair pipeline
lib/
  ai/
    openrouter.ts              single provider access point (model swappable here only)
    generateActivity.ts        the generation call: schema, system prompt, repair support
  sandbox/
    compile.ts                 esbuild + Tailwind JIT compile/validate step
    iframe-html.ts             assembles the sandboxed iframe's srcDoc
  supabase/
    client.ts / server.ts      anon-key clients (browser / server-rendered pages)
    service.ts                 service-role client — server routes only, bypasses RLS
    queries.ts                 typed reads
  generation-constants.ts      retry/timeout constants shared by the pipeline and the UI
  use-is-stale.ts              detects a generating row stuck past its own worst-case time
components/
  generate/                    Generate page: prompt form, activity list, progress UI
  activity/                    Learn page: sandboxed iframe host, error boundary
  ui/                          shadcn primitives (button, input, card, ...)
sdk/
  activity-sdk.ts              the useTutorBridge() hook, bundled into every generated activity
  types.ts                     the fixed contract's types + the host<->activity message protocol
evals/
  generation.eval.yaml         promptfoo suite — run before any prompt/contract change
  run-generation.ts            exec provider calling the real pipeline (not a mock)
supabase/migrations/           schema, RLS policies, Realtime publication
instrumentation.ts             Langfuse tracing registration
```

Everything reachable from the browser is either a Server Component doing a plain read, or a
Client Component talking to our own `/api/*` routes — nothing in the browser ever holds a
service-role key or calls OpenRouter/Supabase's privileged APIs directly.

## How generation works

`POST /api/generate` does the fast part synchronously — insert a row (`status: generating`),
return immediately — then keeps working via Next's `after()`, which is what lets a single
request return in milliseconds while the actual generation (which can take minutes on free
models) continues server-side without blocking the client.

The pipeline (`runGenerationPipeline` in `app/api/generate/route.ts`) is a bounded loop, up to
3 attempts total:

1. **Generate** — `generateActivityCode()` calls the AI SDK's `generateObject` (not
   `generateText`) against a Zod schema returning `{ title, code, actions }`. The system
   prompt encodes the full fixed contract: the generated component may only import `react` and
   `./activity-sdk`; must call `useTutorBridge()` and use `publishState`/`emitEvent`/
   `registerAction`; must use concrete Tailwind palette classes (never our app's semantic
   aliases, which need CSS variables the sandbox doesn't have); and must include a real
   submit/check action, concrete feedback, and a visible "ask for help" affordance — these are
   non-negotiable UX rules, not left to chance per-prompt.
2. **Validate** — `compileActivity()` bundles the generated code with esbuild (the same file
   temp-written alongside the real SDK source, so `./activity-sdk` resolves correctly) and
   separately JIT-compiles a scoped Tailwind stylesheet via Tailwind's `content: [{ raw }]`
   API, containing only the classes the generated code actually uses.
3. **Repair, if needed** — a compile failure feeds the exact structured error (file/line/
   column/message) back into a second `generateActivityCode` call with an instruction to fix
   only what's broken, not start over. Up to 2 repair attempts.
4. **Store or fail honestly** — success stores the validated compiled JS/CSS directly (so the
   Learn page never recompiles what's already been validated); exhausting all 3 attempts
   writes `status: failed` with the real last error — never a disguised success.

Model choice took three rounds of live testing against OpenRouter's actual free tier (the
originally planned models were discontinued from free between planning and implementation).
Full account, including two hung/rate-limited candidates rejected and why the current model
(`cohere/north-mini-code:free`) was kept despite variable latency, is in `CLAUDE.md`
"Reliability."

## How generated code is validated and executed

- **Validated** server-side by esbuild, which transforms/bundles syntax but never executes the
  input — running it there carries none of the risk `eval()` on untrusted code would.
- **Executed** exclusively client-side, inside a sandboxed iframe: `srcDoc` (all JS/CSS inlined,
  no external resource references at all), `sandbox="allow-scripts"` with **no**
  `allow-same-origin` (this is what actually isolates it from the host's cookies/storage/DOM),
  and a CSP baked into that same document (`default-src 'none'`, inline script/style only) —
  this is what prevents any data-exfiltration attempt from generated code, not just what limits
  imports at compile time.
- **Hang protection**: the host sets a handshake timeout — if the iframe doesn't post a
  `READY` message within 5 seconds, it's treated as hung and a failure state is shown rather
  than leaving the tab stuck. A true infinite loop can only be caught by a wall-clock watchdog
  from *outside* the frame, since the frame's own thread would be blocked — this is the
  practical answer to "what happens if generated code enters an infinite loop," with the known
  limitation that it can't recover a hang *mid-interaction* after the activity already loaded.
- **Pre-flight validation before exposure**: compiling is not the same as working — a
  component can compile fine and still throw on mount. The pre-flight render check inside the
  same sandboxed iframe catches this before status ever becomes `ready`.

## What's not built yet

Milestone 3, the tutor↔activity bridge, is the remaining major piece:

- `POST /api/tutor` — context assembly (activity + `last_state` + a plain-language progress
  summary aggregated from a durable `activity_events` log + bounded recent conversation),
  tool-calling constrained to the activity's registered `actions`.
- The live `postMessage` bridge (`STATE_SNAPSHOT`/`STATE_DELTA` out, `ACTION_CALL`/
  `ACTION_RESULT` in) — the SDK contract and protocol types (`sdk/types.ts`) are already built
  and ready for this; the persistence endpoint and the tutor itself are not yet wired.

Full design (already decided, not yet implemented) is in `CLAUDE.md` "AI tutor <-> activity
interface."

## Observability

Langfuse, wired through the AI SDK's built-in OpenTelemetry hook (`instrumentation.ts` +
`telemetry: { isEnabled: true }` on the generation call) — not a bespoke tracer. A trace
captures the full prompt, the full parsed response, model, latency, and token usage for every
generation attempt.

To see traces: set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL` (free
tier at [cloud.langfuse.com](https://cloud.langfuse.com), no card required) in `.env.local`.
With no keys set, tracing is skipped entirely rather than failing requests.

## Tradeoffs made

- **`after()`, not a durable queue.** Generation work continues after the HTTP response via
  Next's `after()`. This is not a queue — if the function is killed mid-callback (a crash, a
  redeploy), that generation is simply lost, with no retry and no record. Acceptable at this
  scale (one generation, low volume); the wrong call under real production traffic, where a
  proper queue/worker (SQS, Vercel Workflows, Inngest) would be correct. A UI-level mitigation
  exists (`useIsStale` + a retry affordance) but the underlying row is never automatically
  recovered.
- **No auth**, per the brief's explicit instruction — RLS is deny-by-default instead: only
  `activities` has a public policy (`SELECT` only), `tutor_messages`/`activity_events` have
  none at all, and all writes go through server routes using the service-role key.
- **Store the compiled bundle, not just source.** `activities.compiled_js`/`compiled_css`
  hold the exact validated output, so the Learn page serves what was already checked instead
  of trusting a second, redundant compile to produce the same thing.
- **A static worst-case time estimate, not a live percentage.** The Generate/Learn pages show
  "attempt X of 3" (an exact fact) and "can take up to 6 minutes" (derived from the pipeline's
  own `MAX_GENERATION_ATTEMPTS × timeout` constants) rather than a ticking per-second counter —
  an earlier version had one, and it read as broken the moment a real run (326s) exceeded the
  per-attempt estimate it was built around.
- **`maxDuration = 500`** on `/api/generate`, sized for 3 attempts at the model's measured
  ~120s worst case. Vercel's Hobby plan caps functions at 60s regardless of this value — this
  pipeline needs a Pro plan (or Fluid Compute) to actually run in production.

## What I'd improve with more time

- Finish Milestone 3 (the tutor) and Milestone 4 (a real visual/interaction polish pass on
  generated activities — "Taste" is explicitly graded and hasn't had a dedicated pass yet).
- Replace `after()` with a real queue/worker if this needed to survive production traffic —
  named above as a known, accepted limitation at this scale, not an oversight.
- A background sweep to actually flip stuck `generating` rows to `failed` server-side (the
  current `useIsStale` fix is a client-side UI affordance, not a server-side guarantee).
- Broaden the eval suite's prompt coverage and add unit tests for the tutor's context-assembly
  logic once Milestone 3 lands.
- Fish Audio voice on the tutor chat (explicit stretch goal, intentionally deferred behind the
  text-first tutor per the brief's stated minimum bar).

## How to run locally

Requires [Bun](https://bun.sh), a Supabase project, and an OpenRouter API key.

```bash
bun install
cp .env.example .env.local   # fill in Supabase + OpenRouter (+ optional Langfuse) values
```

Apply the schema (three tables, RLS policies, Realtime publication — see
`supabase/migrations/`) via the Supabase CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

```bash
bun run dev          # http://localhost:3000
bun run test          # unit tests (compile pipeline, iframe HTML builder)
bun run lint
bun run eval:generation   # promptfoo suite against the real pipeline — slow, real LLM calls
```

`.env.local` variables (see `.env.example` for the full list): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only — never
prefix with `NEXT_PUBLIC_`), `OPENROUTER_API_KEY`, and optionally `LANGFUSE_PUBLIC_KEY`/
`LANGFUSE_SECRET_KEY`/`LANGFUSE_BASE_URL`.
