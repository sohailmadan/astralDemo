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

export const CODEGEN_MODEL = "openai/gpt-oss-120b:free";
export const CODEGEN_FALLBACK_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

export const TUTOR_MODEL = "openai/gpt-oss-20b:free";
export const TUTOR_FALLBACK_MODEL = "meta-llama/llama-3.3-70b-instruct:free";

export function codegenModel(modelId: string = CODEGEN_MODEL) {
  return openrouter(modelId);
}

export function tutorModel(modelId: string = TUTOR_MODEL) {
  return openrouter(modelId);
}
