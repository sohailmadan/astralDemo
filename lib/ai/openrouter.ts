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

// Verified live on OpenRouter's /api/v1/models as of this writing — both originally planned
// models (openai/gpt-oss-120b:free, openai/gpt-oss-20b:free) were discontinued from the free
// tier between planning and implementation, exactly the risk CLAUDE.md calls out. Re-check
// https://openrouter.ai/models if either of these starts failing.
// Real findings from testing multiple candidates (see CLAUDE.md "Reliability" for the full
// account): nvidia/nemotron-3-super-120b-a12b:free hung 18+ minutes once; a smaller/faster
// model (google/gemma-4-26b-a4b-it:free) failed fast but only because Google AI Studio's own
// shared free quota was exhausted upstream — availability, not latency, is the problem there.
// cohere/north-mini-code:free is the one that actually produced excellent output (a genuinely
// good draggable slope-explorer activity) when it succeeded, at variable latency (60-120s+).
// That variability is exactly what the repair loop + honest failure state exists to absorb —
// not something to eliminate by an endless hunt for a mythical fast, reliable free model.
export const CODEGEN_MODEL = "cohere/north-mini-code:free";
export const CODEGEN_FALLBACK_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

// Switched off google/gemma-4-31b-it:free after a real failure: "[Google AI Studio]
// google/gemma-4-31b-it:free is temporarily rate-limited upstream" — Gemma-family free models
// on OpenRouter route through Google AI Studio's OWN shared free quota, a separate bottleneck
// from OpenRouter's, and one this app has no visibility or control over (the same failure mode
// already documented above for google/gemma-4-26b-a4b-it:free). nvidia/nemotron-3.5-lightning
// is explicitly branded for speed and isn't Google-quota-dependent — verify it's still live on
// OpenRouter's /api/v1/models if it starts failing.
export const TUTOR_MODEL = "nvidia/nemotron-3.5-lightning:free";
export const TUTOR_FALLBACK_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

export function codegenModel(modelId: string = CODEGEN_MODEL) {
  return openrouter(modelId);
}

export function tutorModel(modelId: string = TUTOR_MODEL) {
  return openrouter(modelId);
}
