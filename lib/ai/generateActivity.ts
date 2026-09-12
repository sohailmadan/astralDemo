import { generateObject } from "ai";
import { z } from "zod";

import { traceGeneration } from "../trace";
import { CODEGEN_MODEL, codegenModel } from "./openrouter";

export const ActivityGenerationSchema = z.object({
  title: z.string().describe("Short, human-readable title shown in the activity list."),
  code: z
    .string()
    .describe("The full TSX source for the Activity component, per the system prompt's contract."),
  actions: z
    .array(
      z.object({
        name: z.string().describe("Identifier passed to registerAction() in the generated code."),
        description: z
          .string()
          .describe("What this action does, in plain language — used to build the tutor's tools."),
      }),
    )
    .describe("Named actions this activity registers that the tutor may invoke."),
});

export type ActivityGeneration = z.infer<typeof ActivityGenerationSchema>;

/**
 * The fixed contract, in full — see CLAUDE.md "Generation: fixed contract" for why this is
 * constrained rather than "generate any TSX". Every rule here exists because loosening it
 * makes validation, sandboxing, or the tutor-action interface harder for no learner benefit.
 */
const SYSTEM_PROMPT = `You generate a single interactive React learning activity as TypeScript/TSX.

The output must be REAL interactive software the learner explores the concept with — never an
article, a wall of explanatory text, or a static quiz. If the learning request is "teach me
about slope", do not explain slope in prose; build something the learner drags, clicks, types
into, or otherwise manipulates to discover it themselves.

CONTRACT — the generated code must follow this exactly:

1. Export a single default function component taking no required props:
   \`export default function Activity() { ... }\`

2. The ONLY imports allowed are:
   - "react" (hooks: useState, useEffect, useRef, etc.)
   - "./activity-sdk" — provides useTutorBridge()
   No other npm packages. No CSS imports. Everything else must be built from plain React +
   Tailwind utility classes.

3. Call \`const bridge = useTutorBridge()\` and use it to stay connected to the tutor:
   - \`bridge.publishState(state)\` — call this whenever the activity's meaningful state
     changes (state is a plain object, whatever shape makes sense for THIS activity — do not
     force in fields like "attempts" or "correct" if they don't naturally apply).
   - \`bridge.emitEvent(type, payload?)\` — call this for discrete things the learner does
     (e.g. "answer_submitted", "hint_requested", "point_moved", "step_completed"). Emit an
     event for every meaningful learner action, not just some of them — this is how the tutor
     knows what happened.
   - \`bridge.registerAction(name, handler)\` — register every action you listed in the
     \`actions\` field of your response, so the tutor can actually do something inside the
     activity (e.g. highlight a step, change a value, reset with new numbers), not just talk
     about it. Every activity must register at least one real, meaningful action.

4. Styling: Tailwind utility classes only, using concrete palette classes (e.g. bg-sky-500,
   text-slate-900, border-slate-200) — NEVER semantic aliases like bg-primary or text-foreground,
   which don't resolve inside this sandbox. Use relative/flex/grid layout, not fixed pixel
   widths — this must look correct on a narrow phone screen, not just desktop.

5. Non-negotiable UX, regardless of what the activity is:
   - If there's something to check/submit, include a clear, obvious submit/check action —
     never silent auto-grading with no moment of commitment for the learner.
   - Give immediate, concrete feedback after a submission — not just right/wrong, but what
     was right or wrong about it.
   - Include a visible, clearly-labeled way to ask for help (e.g. a "Need a hint?" button)
     that calls bridge.emitEvent("hint_requested", ...) — the tutor is what actually helps,
     this is the on-ramp to it, not a dead end.

6. Keep it focused: one activity, one concept, doing it well. Do not try to cover everything
   related to the topic.

Return JSON matching the schema: a short title, the full code, and the list of actions you
registered (name + plain-language description of what each does).`;

interface PriorAttempt {
  code: string;
  error: string;
}

export async function generateActivityCode(
  prompt: string,
  opts?: { model?: string; priorAttempt?: PriorAttempt },
): Promise<ActivityGeneration> {
  const userContent = opts?.priorAttempt
    ? `Learning request: "${prompt}"

Your previous attempt did not compile:

\`\`\`tsx
${opts.priorAttempt.code}
\`\`\`

Error:
${opts.priorAttempt.error}

Fix only what's broken and return the corrected activity in full.`
    : `Learning request: "${prompt}"`;

  const modelId = opts?.model ?? CODEGEN_MODEL;
  const { object } = await traceGeneration(
    { name: "generate-activity", model: modelId, input: { system: SYSTEM_PROMPT, prompt: userContent } },
    () =>
      generateObject({
        model: codegenModel(modelId),
        schema: ActivityGenerationSchema,
        system: SYSTEM_PROMPT,
        prompt: userContent,
        // 120s reflects real measured latency from testing, not a guess — this model's
        // response time for a typically-verbose (~20k+ token) activity varies from ~60s to
        // well over 90s. /api/generate's maxDuration is sized to fit 3 attempts at this
        // timeout with margin, or the route itself gets killed by the platform before a
        // legitimately-slow-but-working call finishes. See CLAUDE.md "Reliability" for the
        // full account of what was tried and why.
        abortSignal: AbortSignal.timeout(120_000),
        repairText: stripMarkdownFence,
      }),
  );

  return object;
}

// Also observed directly in testing: cohere/north-mini-code:free otherwise produces good
// output but wraps it in a ```json ... ``` fence despite the schema/JSON-mode instruction —
// a common failure mode for free models without first-class structured-output support. Rather
// than avoid an otherwise-good model for this, strip the fence and let the SDK re-parse.
function stripMarkdownFence({ text }: { text: string }): Promise<string | null> {
  const match = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  return Promise.resolve(match ? match[1] : null);
}
