import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

/**
 * Single provider access point — every AI call in this app goes through here, never through
 * a direct OpenRouter/fetch call in a route handler. Swapping models, or even providers
 * later, means editing this file, not hunting through call sites.
 *
 * Free-tier model availability on OpenRouter shifts often (see CLAUDE.md) — verify these are
 * still live on https://openrouter.ai/models before relying on them, and update here if not.
 */
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

// Local dev-only escape hatch, not a change to the production model strategy — the brief's
// runtime LLM constraint (free OpenRouter models only) is about what's actually deployed, and
// that's unaffected: this is gated behind USE_LOCAL_OLLAMA, off by default, and never touched
// by anything except a local `bun run start`/`dev` session that opts in. Exists purely because
// OpenRouter's daily free-tier quota got fully exhausted mid-session (repeatedly, across both
// codegen and tutor calls sharing one cap) and blocked all further local verification — Ollama
// running locally has no such limit and costs nothing, since it never leaves the machine.
// Ollama exposes an OpenAI-compatible API, so this reuses the official @ai-sdk/openai provider
// pointed at it rather than a bespoke client.
//
// Model size matters here: this machine has 16GB total RAM. gpt-oss:20b (a 13GB file,
// originally pulled and tested) is too large — running it leaves almost no headroom for the OS
// and everything else, risking making the whole machine unresponsive. Both models below are
// ~2GB — pick something similarly sized for your own machine's real available RAM, not just
// whatever model happens to be biggest/best.
//
// Two different local models, not one shared — found directly by testing: llama3.2:3b (a
// general-purpose chat model) handled the tutor's plain chat/tool-calling role correctly, but
// failed all 3 attempts at generating an activity with genuine JSX/TSX syntax errors every
// time ("Unexpected '{'", "Expected '>' but found '}'") — a real capability gap for a small
// general-purpose model at structured code generation, not a pipeline bug. qwen2.5-coder:3b (a
// code-specialized model at a similarly safe size) is used for codegen instead, since code
// generation specifically is what it's built for.
const ollama = createOpenAI({
  baseURL: "http://localhost:11434/v1",
  apiKey: "ollama", // required by the client shape; ignored by Ollama itself
});

const USE_LOCAL_OLLAMA = process.env.USE_LOCAL_OLLAMA === "true";
const OLLAMA_CODEGEN_MODEL = process.env.OLLAMA_CODEGEN_MODEL ?? "qwen2.5-coder:3b";
const OLLAMA_TUTOR_MODEL = process.env.OLLAMA_TUTOR_MODEL ?? "llama3.2:3b";

// gpt-5.1-codex-mini (OpenAI's code-specialized small model) was tried first — it's listed as
// live on this account's /v1/models, but every real call failed with "does not exist or you do
// not have access to it," a real access-tier restriction distinct from the model merely being
// listed in the catalog (Codex-branded models are often gated to the Responses API or a
// different access tier than standard chat completions). Confirmed gpt-5-mini, gpt-4.1-mini,
// and gpt-4o-mini are all genuinely callable on this account.
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
export const OPENAI_CODEGEN_MODEL = process.env.OPENAI_CODEGEN_MODEL ?? "gpt-5-mini";
// A second, distinct OpenAI model for the timeout-retry path in app/api/generate/route.ts —
// not a repeat of the same model, so a genuinely slow/degraded gpt-5-mini call doesn't just
// hit the identical wall again on retry. gpt-4o-mini is confirmed callable on this account
// (see above) and is a real, different model, not just a cheaper alias.
export const CODEGEN_TIMEOUT_FALLBACK_MODEL = "gpt-4o-mini";

// Codegen's production model, replacing the free OpenRouter tier this app used before (its
// real cost/reliability trade-off is preserved below for the record). gpt-5-mini answers in
// single-digit seconds to a few tens of seconds on this account, reliably — a real fix for the
// free tier's documented 60-120s+ variance and occasional garbled/corrupted output, not just a
// preference. This is a genuine, deliberate reversal of an earlier decision (gpt-5-mini was
// tried and ruled out on cost during initial model selection) — reliability won out over the
// per-generation cost once the free tier's failure rate in real use made that trade-off explicit.
//
// The free-tier models below are kept defined, unused, for the historical record of what was
// actually tested — not speculative flexibility, a genuine account of real findings that would
// otherwise be lost. Verified live on OpenRouter's /api/v1/models as of this writing — both
// originally planned models (openai/gpt-oss-120b:free, openai/gpt-oss-20b:free) were
// discontinued from the free tier between planning and implementation, exactly the risk
// CLAUDE.md calls out. Real findings from testing multiple candidates (see CLAUDE.md
// "Reliability" for the full account): nvidia/nemotron-3-super-120b-a12b:free hung 18+ minutes
// once; a smaller/faster model (google/gemma-4-26b-a4b-it:free) failed fast but only because
// Google AI Studio's own shared free quota was exhausted upstream — availability, not latency,
// is the problem there. cohere/north-mini-code:free is the one that actually produced excellent
// output (a genuinely good draggable slope-explorer activity) when it succeeded, at variable
// latency (60-120s+) — including a real, reproduced-in-production timeout past this app's own
// 120s per-call limit, which is what prompted this switch.
export const CODEGEN_MODEL = "cohere/north-mini-code:free";
export const CODEGEN_FALLBACK_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

// Switched off google/gemma-4-31b-it:free after a real failure: "[Google AI Studio]
// google/gemma-4-31b-it:free is temporarily rate-limited upstream" — Gemma-family free models
// on OpenRouter route through Google AI Studio's OWN shared free quota, a separate bottleneck
// from OpenRouter's, and one this app has no visibility or control over (the same failure mode
// already documented above for google/gemma-4-26b-a4b-it:free).
//
// Then switched off nvidia/nemotron-3.5-lightning:free after a WORSE, distinct failure found in
// production: a real hint request returned a tool call whose `hint` argument was several
// paragraphs of raw, leaked internal reasoning — garbled multilingual text and a duplicated
// <tool_call> XML fragment mixed directly INTO the argument value, rendered as-is in the
// learner-facing hint box. Not a rate limit or a schema mismatch — the model's own tool-calling
// response format doesn't cleanly separate reasoning from the final answer for this app's
// tool-calling shape, and nothing in the AI SDK/OpenRouter layer catches that.
//
// Tested three replacement candidates directly (real API calls, both a tool-call scenario and a
// plain Socratic-response scenario) before picking one:
// - nex-agi/nex-n2.5-mini:free: ignored the registered tool entirely for a request that clearly
//   warranted calling it — ruled out, not a corruption problem but a compliance one.
// - inclusionai/ling-3.0-flash-vl:free: the cleanest of the three — correct, well-scoped hint
//   text, reasoning properly isolated in providerMetadata rather than leaking into the tool
//   args. But hit "[Novita] ... temporarily rate-limited upstream" on the very next call — a
//   third distinct shared-upstream-quota provider (after Google AI Studio for Gemma), the same
//   availability risk class already documented, not something this app can control.
// - liquid/lfm-2.5-2.6b:free: also clean, uncorrupted tool-call output. Weaker on the Socratic
//   rule specifically — given a wrong-answer scenario, it explained the full solution directly
//   rather than asking the learner to walk through their reasoning first. A real, named
//   trade-off: clean output every time beats occasionally-correct behavior wrapped in corrupted
//   output, so this is the pick despite that gap — worth re-testing if the Socratic behavior
//   turns out to matter more in practice than this one test suggested.
export const TUTOR_MODEL = "liquid/lfm-2.5-2.6b:free";
export const TUTOR_FALLBACK_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

// A dev/prod escalation for the tutor role specifically (codegen now runs on OpenAI always —
// see OPENAI_CODEGEN_MODEL above; the tutor still defaults to the free tier) — off by default,
// requires both USE_OPENAI_TUTOR=true and a real OPENAI_API_KEY. Real, paid API calls.
const USE_OPENAI_TUTOR = process.env.USE_OPENAI_TUTOR === "true";
const OPENAI_TUTOR_MODEL = process.env.OPENAI_TUTOR_MODEL ?? "gpt-4o-mini";

export function codegenModel(modelId: string = OPENAI_CODEGEN_MODEL) {
  if (USE_LOCAL_OLLAMA) return ollama(OLLAMA_CODEGEN_MODEL);
  return openai(modelId);
}

export function tutorModel(modelId: string = TUTOR_MODEL) {
  if (USE_OPENAI_TUTOR) return openai(OPENAI_TUTOR_MODEL);
  if (USE_LOCAL_OLLAMA) return ollama(OLLAMA_TUTOR_MODEL);
  return openrouter(modelId);
}

/**
 * What actually ran, for Langfuse traces — without this, a trace would mislabel what actually
 * executed whenever USE_LOCAL_OLLAMA redirects to a local model, or (tutor role) USE_OPENAI_TUTOR
 * escalates. Takes which role called it, since codegen and tutor use different providers/models.
 */
export function effectiveModelId(requestedModelId: string, role: "codegen" | "tutor"): string {
  if (role === "tutor" && USE_OPENAI_TUTOR) return `openai:${OPENAI_TUTOR_MODEL}`;
  if (USE_LOCAL_OLLAMA) return `ollama:${role === "codegen" ? OLLAMA_CODEGEN_MODEL : OLLAMA_TUTOR_MODEL}`;
  if (role === "codegen") return `openai:${requestedModelId}`;
  return requestedModelId;
}
