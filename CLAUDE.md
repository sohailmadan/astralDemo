@AGENTS.md

# Astral Take-Home — Architecture Notes

Read this before touching generation, the sandbox, or the tutor bridge — several decisions
here are load-bearing and easy to accidentally regress.

## What this app is

A two-page app: `/` turns a natural-language learning request into real, executable
TypeScript/React code for an interactive activity (not an article, not a JSON lesson rendered
through a fixed template); `/activities/<id>` renders that generated activity next to an AI
tutor that can observe and act on its live state. This file is the durable record of the
decisions that matter going forward — read it before touching generation, the sandbox, or the
tutor bridge.

## No auth, intentionally

The brief explicitly says not to build auth and to not spend time on it. The starter
template's auth pages, `proxy.ts` middleware, and tutorial components were deleted for this
reason — do not re-add an auth gate. This makes Row Level Security the only thing standing
between the public internet and the database (see Security below).

## Generation: fixed contract, not free-form code

The LLM is prompted (via `generateObject`, not `generateText`) against a Zod schema returning
`{ title, code, actions }` — not just raw code — so the UI and tutor know what an activity is
and can do without re-parsing generated source. The generated `code` must satisfy a fixed SDK
contract (`export default function Activity(props)`, `useTutorBridge()` for
`publishState`/`emitEvent`/`registerAction`, no external npm imports). This constraint is
deliberate: an unconstrained "generate any TSX" approach makes validation, sandboxing, and the
tutor-action interface all much harder for no benefit to the learner. Do not loosen it.

Pipeline: generate -> esbuild compile (server-side, safe — esbuild transforms syntax, it never
executes the input) -> pre-flight render smoke-test in the sandbox -> only then `ready`. A
compile or render failure re-enters a bounded repair loop (feed the error back to the model),
not an infinite retry. Exhausting retries means `status: failed`, shown honestly — never a
disguised static fallback pretending to be the generated activity.

## State is generic, not quiz-shaped — do not add named attempts/hints fields

The brief's own examples span an exploratory slope-dragger (no right/wrong at all), a stepwise
long-division workspace, and a counting manipulative. The SDK contract's state is a free-form
snapshot (`Record<string, unknown>`) plus a generic events log (`{ type, payload, timestamp }`)
— nothing about "questions" or "correctness" is hard-coded. "How many hints were used" is
answered by aggregating `activity_events` server-side (`type = 'hint_requested'`), never by a
named field on the state object. If you're tempted to add `attempts`/`hintsUsed` fields to the
contract, don't — that's exactly the coupling this design avoids.

## State and events are durably persisted — this is not optional polish

Every `publishState`/`emitEvent` call in a generated activity posts to the host, which both
updates its own in-memory view AND calls `POST /api/activities/[id]/events`, which appends to
the `activity_events` table and upserts `activities.last_state`. This is what makes "the tutor
knows what happened" a real, queryable fact instead of something that only exists in one
browser tab and evaporates on refresh. Do not revert this to an in-memory-only approach — it
is the mechanism behind the plan's "how many hints were used" requirement.

## Tutor context assembly (`/api/tutor`), in order

1. Fetch the `activities` row: `prompt`, `title`, `actions`, `last_state`.
2. Fetch `activity_events`, compute a short plain-language progress summary (aggregate counts
   — "2 questions answered, 1 hint used" — not a raw event dump; far more legible to a small
   free model and cheap to compute).
3. Fetch the last ~15-20 `tutor_messages` rows (bounded — never the full session history).
4. Assemble the system prompt from (1)+(2), then the bounded history from (3) as the actual
   turns.

Tool-calling uses the AI SDK's native `tools` built from the activity's `actions`, Zod-
validated before a call ever reaches the iframe. Tutor tone is deliberately Socratic on a
wrong answer (ask the learner's reasoning before giving the answer away), short, warm — this
is checked by `evals/tutor.eval.yaml`, easy for a prompt edit to quietly regress.

## Safe execution boundary

Compiled bundles render in a `srcdoc` iframe: `sandbox="allow-scripts"` only (deliberately no
`allow-same-origin`), a strict CSP (`default-src 'none'`, no `connect-src`/fetch/XHR/WebSocket
— this is what actually prevents data exfiltration, not just what blocks imports), and a
handshake timeout that treats a non-responding frame as hung rather than leaving the tab stuck
(the practical answer to "what if generated code enters an infinite loop" — a wall-clock
watchdog from outside the frame, since the frame's own thread is blocked). `ActivityFrame` is
wrapped in a React error boundary on the host side — that boundary catches bugs in *our*
bridge code, not the sandboxed activity, which can never reach the host thread at all.

## Which Supabase key does what — do not mix these up

Server routes (`/api/generate`, `/api/tutor`, `/api/activities/[id]/events`) use
`lib/supabase/service.ts` (service-role key, bypasses RLS, server-only, never imported by
client code). The browser's Realtime subscription and any client-side reads use the anon key
via `lib/supabase/client.ts`. RLS is deny-by-default: `activities` has exactly one public
policy (anon `SELECT`, needed for Realtime); `tutor_messages` and `activity_events` have none
— the client never queries either directly, only through server routes.

## Realtime, not polling, drives the no-refresh requirement

The Generate page subscribes to both `INSERT` and `UPDATE` on `activities` (update-only is the
easy way to accidentally miss "a new row must appear the instant Generate is clicked"). The
Learn page does its own initial server-side fetch (not reliant on Realtime for state before a
client subscribes) and separately subscribes only when status is still `generating`, to handle
the direct-URL case (refresh, back button, shared link hitting an activity that isn't `ready`).

`/api/generate` relies on Next's `after()` to keep the function alive after responding —
without it, a Vercel serverless function can be killed right after sending its response,
silently stranding a row at `generating` forever. This is not a durable queue (no retry if
killed mid-callback) — acceptable at this scale, would not be under real production traffic
(see the plan doc's "what I'd improve").

## Reliability — what was actually observed, not assumed

Real findings from testing the generation pipeline against live OpenRouter free models (the
brief explicitly asks for this account — "what failure modes did you discover, what did you
change after discovering them"):

- **openai/gpt-oss-120b:free / openai/gpt-oss-20b:free** (originally planned) — discontinued
  from the free tier between planning and implementation. Confirms the plan's own warning that
  free-tier lineups shift; always verify against OpenRouter's live `/api/v1/models` before
  wiring a model in.
- **nvidia/nemotron-3-super-120b-a12b:free** — hung for 18+ minutes with no response and no
  error on one call. This is why `generateActivityCode` has an explicit `abortSignal` timeout —
  without it, one stalled call would block the entire pipeline indefinitely. Kept as the
  fallback model, not primary.
- **google/gemma-4-26b-a4b-it:free** — failed fast (~6s), but only because Google AI Studio's
  own shared free quota was exhausted upstream (a distinct failure mode: availability, not
  latency). Not used as primary for this reason — a model rejected here would be a fine choice
  again once that shared quota isn't the bottleneck.
- **cohere/north-mini-code:free** (current primary) — the one that actually produced excellent
  output when it worked: a genuinely good draggable coordinate-plane slope-explorer with a
  registered `reset` action, correct `publishState`/`emitEvent` usage, matching the brief's
  "real interactive software" bar, not an article. Two real, distinct failure modes observed
  and both handled by design, not patched around after the fact:
  1. Wraps valid JSON in a ` ```json ` markdown fence despite the schema instruction — handled
     by `generateActivity.ts`'s `repairText` hook, which strips the fence before the SDK
     re-parses, rather than avoiding an otherwise-good model for this.
  2. Variable latency (60s to 120s+) for its typically-verbose (~20k+ token) output — the
     `abortSignal` timeout and `maxDuration` are both sized against this measured behavior, not
     guessed.
  3. Also produced a genuine compile bug once (reassigning a `const`) that survived the full
     repair loop (2 attempts) unfixed — the pipeline correctly reported `status: failed` with
     the real compile error rather than a disguised success. This is the repair loop's
     documented limit working as designed, not a bug in our code.
- **What this means in practice**: free-tier model reliability is genuinely variable, exactly
  as the plan anticipated — the repair loop, bounded retries, and honest `failed` state are
  load-bearing, not defensive programming for a hypothetical. Do not read an occasional
  `failed` activity as a bug to chase; read the *error message on that row* to tell timeout,
  upstream rate-limit, and genuine unfixed compile bug apart, since each means something
  different about the pipeline vs. the model vs. OpenRouter's shared free capacity that day.

## Milestone/cut order, if time runs out

Voice (Fish Audio) is cut first, then Milestone 4 polish, then breadth of test prompts. Never
cut: the core generate -> validate -> execute -> render loop, or tutor state visibility.

## Confidentiality

The take-home brief this app implements is confidential — do not publish its contents
externally (no public artifact, no third-party posting) from within this repo or elsewhere.
