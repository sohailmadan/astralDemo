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
        args: z
          .array(
            z.object({
              name: z.string().describe("Key the handler reads off its payload object, e.g. \"hint\"."),
              description: z
                .string()
                .describe("What this argument means, in plain language — used to build the tutor's tool schema, so the tutor knows to actually fill it in."),
            }),
          )
          .describe(
            "String arguments this action's handler expects on its payload object, if any (e.g. a hint action expecting { hint: string }). Empty array for a zero-argument action like reset.",
          ),
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
     If the handler needs specific information to do its job (e.g. a "provide_hint" action's
     handler needs actual hint text, not just a bare call with no content), declare that in the
     action's \`args\` field with the exact key the handler reads off its payload object (e.g.
     \`payload.hint\`) — this is what lets the tutor actually fill it in with real content
     instead of calling the action with nothing. Leave \`args\` empty only for a genuinely
     zero-argument action like "reset".

4. Styling: Tailwind utility classes only, using concrete palette classes (e.g. bg-sky-500,
   text-slate-900, border-slate-200) — NEVER semantic aliases like bg-primary or text-foreground,
   which don't resolve inside this sandbox. Use relative/flex/grid layout, not fixed pixel
   widths — this must look correct on a narrow phone screen, not just desktop.
   When multiple buttons are stacked vertically (e.g. Submit, hint, reset), give them all the
   same width (e.g. \`w-full\` inside a \`flex flex-col\` container) and consistent spacing via a
   single \`gap-*\` on the container — never mix per-button margins, which produces a ragged,
   inconsistent-width stack.

5. Non-negotiable UX, regardless of what the activity is:
   - If there's something to check/submit, include a clear, obvious submit/check action —
     never silent auto-grading with no moment of commitment for the learner.
   - Give immediate, concrete feedback after a submission — not just right/wrong, but what
     was right or wrong about it.
   - Include a visible, clearly-labeled way to ask for help (e.g. a "Need a hint?" button)
     that calls bridge.emitEvent("hint_requested", ...) — the tutor is what actually helps,
     this is the on-ramp to it, not a dead end.
   - If a button performs an action rather than just submitting/checking (e.g. a step in a
     multi-step process like "subtract 6 from both sides"), its effect must be understandable
     BEFORE clicking, not discoverable only by clicking it. Precede a set of action buttons with
     a short line explaining what they do (e.g. "Do these steps in order:") so they never read
     as a passive list of instructions or hints — the button text should describe an action the
     learner takes, not narrate a fact.
   - Ordered/sequential steps (do X, then Y, then Z) must use three visually distinct states,
     not just enabled/disabled: DONE (muted color, a checkmark, past-tense label — e.g. a light
     gray "✓ Step 1: Subtracted 6"), the one CURRENTLY ACTIONABLE step (strongly highlighted —
     e.g. a ring/border plus its normal color — so it is unmistakable which one to do next, not
     merely "not grayed out"), and steps not yet reachable (visibly muted, disabled, no special
     label). Never leave more than one step looking equally actionable at the same time.
   - When a step transforms a value shown on screen, show what happened to EVERY part it
     affected, not just whichever part changed most visibly. E.g. dividing an equation by a
     number changes both a coefficient (which may just disappear, e.g. "2x" -> "x") and a
     constant (an obvious arithmetic change, e.g. "8" -> "4") — if only the obvious side is
     shown, the less-obvious change reads as if nothing happened there, even though the same
     operation applied to it. Show the actual before/after operation explicitly (e.g.
     "2x ÷ 2 = 8 ÷ 2 → x = 4"), not just the collapsed end state.

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
        // Widened from 120s after repeated real-world timeouts at that limit (several
        // attempts genuinely still working, just slow on this free tier) — 10 minutes gives
        // room to actually see a call complete rather than keep cutting off in-progress work.
        // Real cost of this: 3 attempts at a full 10 minutes each is 30 minutes worst case,
        // which exceeds any realistic Vercel serverless function limit (even Pro + Fluid
        // Compute tops out far below that) — this value is appropriate for local testing
        // (`bun run start`, no wall-clock kill) while verifying the pipeline can actually
        // succeed at all; it is not the production-ready number. See CLAUDE.md "Reliability."
        abortSignal: AbortSignal.timeout(600_000),
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
