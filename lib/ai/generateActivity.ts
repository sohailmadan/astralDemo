import { generateObject } from "ai";
import { z } from "zod";

import { traceGeneration } from "../trace";
import { CODEGEN_MODEL, codegenModel, effectiveModelId } from "./openrouter";

export const ActivityGenerationSchema = z.object({
  title: z
    .string()
    .describe(
      "Short, human-readable title shown in the activity list. Name the CONCEPT being taught " +
        "(e.g. \"Long Division Practice\"), never the specific example's numbers/values " +
        "(e.g. not \"Long Division of 1548 by 12\").",
    ),
  code: z
    .string()
    .describe(
      "The full TSX source for the Activity component, per the system prompt's contract.",
    ),
  actions: z
    .array(
      z.object({
        name: z
          .string()
          .describe(
            "Identifier passed to registerAction() in the generated code.",
          ),
        // Optional, same reasoning as args below: found directly in production, a response
        // whose JSON was completely valid (parsed fine) still failed schema validation because
        // this field was missing entirely on every declared action — while args' OWN
        // description was already optional, this is the action's own top-level description,
        // a separate field, still required until this change. Falls back to a generic
        // "no description provided" note in lib/ai/tutor.ts's tool-building rather than losing
        // the whole generation over one omitted string.
        description: z
          .string()
          .optional()
          .describe(
            "What this action does, in plain language — used to build the tutor's tools.",
          ),
        // Optional, not required: a free model that otherwise produces a perfectly valid
        // response can still omit this field for a simple action (e.g. one with no arguments)
        // without realizing that's meaningful — if this were required, that single omission
        // fails the ENTIRE response's schema validation before any code is even produced,
        // discarding an otherwise-good generation over one missing empty array. Found directly
        // in production: two consecutive real failures ("response did not match schema") on
        // cohere/north-mini-code:free, neither of which had any code to show for a repair
        // attempt to work from — this is a worse failure mode than the args-less contract it
        // replaced, not a strict improvement, until this is optional.
        args: z
          .array(
            z.object({
              name: z
                .string()
                .describe(
                  'Key the handler reads off its payload object, e.g. "hint".',
                ),
              // Optional too, same reasoning as args itself: found directly in production, the
              // model produced {"name":"hint","type":"string"} instead of our {name,
              // description} shape — defaulting to the familiar OpenAI-style function-parameter
              // convention ({name, type}) rather than following this specific contract. That one
              // substitution failed the entire response's validation. description alone is
              // enough to build a usable tool schema (see lib/ai/tutor.ts's
              // buildActionInputSchema, which falls back to the arg's name when it's missing) —
              // not worth losing an otherwise-good generation over.
              description: z
                .string()
                .optional()
                .describe(
                  "What this argument means, in plain language — used to build the tutor's tool schema, so the tutor knows to actually fill it in.",
                ),
            }),
          )
          .optional()
          .describe(
            "String arguments this action's handler expects on its payload object, if any (e.g. a hint action expecting { hint: string }). Omit or leave empty for a zero-argument action like reset.",
          ),
      }),
    )
    .describe(
      "Named actions this activity registers that the tutor may invoke.",
    ),
});

export type ActivityGeneration = z.infer<typeof ActivityGenerationSchema>;

/**
 * The fixed contract, in full — see CLAUDE.md "Generation: fixed contract" for why this is
 * constrained rather than "generate any TSX". Every rule here exists because loosening it
 * makes validation, sandboxing, or the tutor-action interface harder for no learner benefit.
 */
const SYSTEM_PROMPT = `Generate a small, real piece of interactive software that teaches the requested topic — not an
explanation, article, or quiz-with-text. The learner must discover the concept by interacting with
a concrete example, not by reading about it.

Pick the example's real numbers/values yourself and show them on screen immediately — never open
on a blank form asking the learner to type in the problem first.

If the topic is a multi-step process, break it into the steps that actually matter for learning
it — each one a genuine decision or insight, not a rote sub-operation. Too many tiny steps bores
and loses the learner as much as too few; chunk the process the way a good teacher would. Give the
learner a place to enter EACH such step separately, validate each one as they go, and offer a
"Need a hint?" action when they're stuck — never a single input that just asks for the final
answer. Design the interaction genuinely appropriate to THIS specific topic, not a generic form
reused across topics.

The hint action must ONLY call \`bridge.emitEvent("hint_requested", ...)\` — never display its own
canned hint text. Giving actual help is the AI tutor's job, not the activity's; the activity's role
is to surface the request and get out of the way.

When a step's prompt depends on a value or choice from an earlier step, write it ACTUALLY into the
prompt text (e.g. "Multiply 3 by 12", "Combine un- with happy", "The gas you just identified") —
never a vague placeholder like "that digit" or "the result", which forces the learner to remember
or re-derive something already known.

Show only ONE step at a time — never the whole list of steps up front, and never a preview/summary
that reveals a step's answer (a computed value, the correct choice, the final result, etc.) before
the learner has actually submitted their own attempt at it.

When the topic is inherently visual or spatial (e.g. graphs, shapes, motion, position), the
activity must render an actual visual/interactive element the learner manipulates directly (an
SVG or canvas coordinate plane, a draggable point, a shape, etc.) — a text-only question that
merely asks about a value (e.g. "what is the slope?") does not satisfy this, even if it's phrased
as a step. Never offer a "reveal answer" shortcut the learner can click to see the answer directly
— giving that away is the AI tutor's judgment call to make (via a real action it invokes), not a
button the activity hands the learner.

The AI tutor is a second, essential surface: it should be able to actually do things inside the
activity when the learner asks for help — not just talk. Whatever actions make sense for this
topic must be real \`registerAction\` calls, not just chat replies.

The event names, state shape, and action names you use are internal plumbing between the activity
and the tutor — never render them, describe them, or any other implementation detail as visible
text or debug output in the UI. Never include meta-commentary about the tutor integration either
(e.g. "You can also ask the tutor to reveal a step"). The learner must only ever see the activity's
actual educational content.

Follow this contract exactly:

1. \`export default function Activity({ initialState }) { ... }\` — the only export. \`initialState\`
   is optional and may be \`null\` (a fresh activity) or the last state you previously published via
   \`bridge.publishState\` (the learner returned to this activity). When it's present, initialize
   your \`useState\` calls from it instead of your own hardcoded example defaults, so returning
   learners resume exactly where they left off instead of restarting.

2. Always include both, exactly:
   \`import { useState, useEffect } from "react";\`
   \`import { useTutorBridge } from "./activity-sdk";\`
   These are the only imports allowed — no other packages, no CSS. Everything else is plain
   React + Tailwind.

3. NEVER use a \`<form>\` element, or a \`<button type="submit">\`, anywhere. The sandboxed iframe
   this runs in has no \`allow-forms\` permission, so submitting a form is silently blocked by the
   browser — this can prevent your click handler from ever running at all, making the button look
   completely dead with no visible error. Use a plain \`<div>\` wrapper and \`<button type="button">\`
   (or no \`type\` attribute) with \`onClick\`, never \`onSubmit\`.

4. \`const bridge = useTutorBridge()\`:
   - \`bridge.publishState(state)\` whenever the activity's state changes — this is the only way
     the tutor knows what's happening; it cannot see the rendered screen. Always include the
     CURRENT step's actual question/instruction text verbatim (e.g. "Multiply 2 by 13"), not just
     a step index or type — the tutor cannot infer what's literally being asked from numbers
     alone, and a mismatch here means its hints answer the wrong step.
   - \`bridge.emitEvent(type, payload?)\` for learner actions (e.g. "answer_submitted",
     "hint_requested").
   - \`bridge.registerAction(name, handler)\`: every entry in \`actions\` must have a matching
     \`bridge.registerAction("that exact name", ...)\` call in the code. If the handler reads a
     field off its payload, declare it in that action's \`args\`. Register real actions for
     whatever a learner might reasonably ask the tutor to do on their behalf here — at minimum,
     filling in the current answer/value and submitting/checking it, so "can you do this one for
     me?" actually works, not just a single token action. An action that sets a value MUST update
     the exact same state variable the corresponding input's displayed value reads from — if the
     action succeeds (the tutor sees "done") but the field on screen doesn't visibly change, that
     action is broken even though it reported success.

5. Tailwind utility classes only, using concrete colors (e.g. bg-sky-500) — no semantic aliases
   like bg-primary.

6. If you implement drag-to-move (e.g. a draggable point on a graph) using
   \`window.addEventListener\`/\`document.addEventListener\` for pointer/mouse move, NEVER read a
   piece of component state directly inside that listener's closure — \`setState\` doesn't update
   it synchronously, so the listener keeps seeing the STALE value from when it was attached (e.g.
   a "which point is being dragged" check that always sees its old value, so the drag visibly
   starts but never actually updates anything). Store that value in a \`useRef\` you update
   alongside the state, and read the ref inside the listener instead.

7. Include a submit/check action, feedback after submitting, and a "Need a hint?" action that
   emits \`hint_requested\`. On the LAST step, correct feedback must say the activity is complete —
   never a generic "moving to the next step" when there isn't one. Any explanatory text you show
   (feedback, an intro line, etc.) should build understanding one small idea at a time — never
   dump the full method or solution in a single block of text.

Return a single JSON object: \`title\`, \`code\` (the full TSX source as a string), \`actions\`.
Nothing else — no prose, no markdown fence. Escape every line break inside \`code\` as \\n.`;

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
    {
      name: "generate-activity",
      model: effectiveModelId(modelId, "codegen"),
      input: { system: SYSTEM_PROMPT, prompt: userContent },
    },
    () =>
      generateObject({
        model: codegenModel(modelId),
        schema: ActivityGenerationSchema,
        system: SYSTEM_PROMPT,
        prompt: userContent,
        // 120s per attempt — gpt-4o-mini responds well within this on a normal call, so this is
        // a real timeout (catches a genuinely stuck call), not headroom for known slow free-tier
        // latency like the old OpenRouter free models needed. 3 attempts at 120s each is 6
        // minutes worst case (see MAX_TOTAL_MINUTES in lib/generation-constants.ts, which this
        // must stay in sync with), comfortably under any realistic Vercel serverless limit.
        abortSignal: AbortSignal.timeout(120_000),
        repairText: repairModelJson,
        // OpenAI's strict structured-outputs mode (the @ai-sdk/openai provider's default)
        // requires every property in the schema to appear in JSON Schema's `required` array —
        // it has no concept of "optional," only "present but nullable." Our schema uses plain
        // Zod .optional() on several fields specifically because free/local models don't
        // reliably fill them in (see the .optional() fields' own comments) — under strict mode
        // that produces a hard, deterministic API-level rejection on every single attempt
        // ("'required' is required to be supplied... Missing 'description'"), not a retryable
        // model failure. This key is OpenAI-specific and namespaced; other providers
        // (OpenRouter, Ollama via its OpenAI-compatible endpoint) simply ignore it.
        providerOptions: { openai: { strictJsonSchema: false } },
      }),
  );

  // A distinct fence problem from the one below: found directly in production, the model can
  // produce perfectly valid JSON where the `code` FIELD'S OWN STRING VALUE is wrapped in a
  // ```tsx ... ``` fence — passes schema validation fine (it's still a string), but would fail
  // to compile since the fence markers are literal text baked into what's supposed to be TSX
  // source. stripMarkdownFence (below) can't catch this — it only strips a fence around the
  // ENTIRE response text, before JSON.parse ever runs, not inside one already-parsed field.
  const codeFenceMatch = object.code.match(
    /^```(?:tsx?|jsx?)?\s*\n([\s\S]*?)\n```\s*$/,
  );
  const finalCode = codeFenceMatch ? codeFenceMatch[1] : object.code;

  // Prompt instructions alone haven't been reliable here: found THREE separate times in
  // production, on three different activities, that the model declares an action but omits
  // `args` even though its own handler clearly reads payload.hint — repeating the exact same
  // "hint sent but nothing visible" bug each time despite the system prompt explicitly asking
  // for this. Rather than keep patching each generated activity's stored `actions` by hand
  // (doesn't scale — every new generation can reproduce the same gap), this derives the real
  // requirement directly and deterministically from the code the model actually wrote, so it
  // no longer depends on the model remembering to declare it correctly.
  const finalActions = inferMissingActionArgs(finalCode, object.actions);

  return { ...object, code: finalCode, actions: finalActions };
}

/**
 * For any action missing `args`, scans the source for `payload.<field>`/`payload?.<field>`
 * access within a window of text right after that action's `registerAction(...)` call — an
 * approximation of "the handler passed to this call," not a full parser. Catches the pattern
 * observed in every real occurrence so far (an inline arrow function directly accessing
 * payload.<field>). Named limits, not hidden: won't catch destructuring
 * (`const { hint } = payload`) or a handler defined elsewhere and only referenced by name.
 * Exported for testing.
 */
export function inferMissingActionArgs(
  code: string,
  actions: ActivityGeneration["actions"],
): ActivityGeneration["actions"] {
  // Every registerAction(...) call's position, in source order — used to bound each action's
  // scan window at the START of the NEXT call (any name), not a fixed size. A fixed-size window
  // (tried first) bled a second action's payload field into an earlier one whenever two
  // handlers sat close together in the source, which real generated code does often — caught by
  // this function's own test suite before it ever reached production.
  const allCallPositions = Array.from(
    code.matchAll(/registerAction\s*\(\s*['"][^'"]+['"]/g),
  ).map((m) => m.index);

  return actions.map((action) => {
    if (action.args && action.args.length > 0) return action;

    const registerCallPattern = new RegExp(
      `registerAction\\s*\\(\\s*['"]${escapeRegExp(action.name)}['"]`,
    );
    const match = registerCallPattern.exec(code);
    if (!match) return action;

    const windowEnd =
      allCallPositions.find((pos) => pos > match.index) ?? code.length;
    const windowText = code.slice(match.index, windowEnd);
    const fieldNames = new Set<string>();
    const fieldPattern = /payload\??\.(\w+)/g;
    let fieldMatch: RegExpExecArray | null;
    while ((fieldMatch = fieldPattern.exec(windowText))) {
      fieldNames.add(fieldMatch[1]);
    }

    if (fieldNames.size === 0) return action;

    return {
      ...action,
      args: Array.from(fieldNames).map((name) => ({
        name,
        description: `Inferred from the handler's own payload.${name} access — the model did not declare this argument itself.`,
      })),
    };
  });
}

/**
 * Deterministic check for the exact bug found in production: a small local codegen model
 * (qwen2.5-coder:3b) generated an activity that compiled and ran perfectly fine, but never
 * called bridge.registerAction() for ANY of the names it listed in `actions` — it had treated
 * the field as a list of its own internal click-handler/event names instead of genuinely
 * registered actions. The tutor could observe state but could never actually act on the
 * activity ("Unknown action" on every attempt) — a silent, un-catchable-by-compilation failure
 * of exactly the capability the brief calls "the most important part."
 *
 * Returns the names that have NO matching registerAction("that name", ...) call anywhere in
 * the code — feed this back into the repair loop exactly like a compile error, since fixing it
 * doesn't require regenerating everything, just actually wiring up the missing calls.
 */
export function findUnregisteredActions(
  code: string,
  actions: ActivityGeneration["actions"],
): string[] {
  return actions
    .map((a) => a.name)
    .filter(
      (name) =>
        !new RegExp(
          `registerAction\\s*\\(\\s*['"]${escapeRegExp(name)}['"]`,
        ).test(code),
    );
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Combines two independent repairs for the AI SDK's `repairText` hook (see generateObject
// call above), tried in sequence, either of which may be a no-op on any given response:
//
// 1. Also observed directly in testing: cohere/north-mini-code:free otherwise produces good
//    output but wraps it in a ```json ... ``` fence despite the schema/JSON-mode instruction —
//    a common failure mode for free models without first-class structured-output support.
//
// 2. Found directly in production ("could not parse the response" on a `code` field
//    containing genuinely good source): the model can emit a literal, raw newline character
//    instead of the escaped \n it used correctly everywhere else in the same string — observed
//    at a JS template-literal interpolation boundary inside the generated code
//    (`` `...${ `` followed by an actual line break rather than `\n`). JSON forbids raw control
//    characters inside a string; one such slip breaks parsing of an otherwise well-formed
//    response. escapeRawControlCharsInStrings walks the text tracking whether it's inside a
//    string literal and re-escapes any raw newline/tab/carriage-return found there.
//
// Rather than avoid an otherwise-good model for either issue, repair the text and let the SDK
// re-parse — returns null (no repair) only if neither transform changed anything.
function repairModelJson({ text }: { text: string }): Promise<string | null> {
  const fenceMatch = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  const unfenced = fenceMatch ? fenceMatch[1] : text;

  const repaired = escapeRawControlCharsInStrings(unfenced);
  return Promise.resolve(repaired === text ? null : repaired);
}

/** Exported for testing. See repairModelJson above for why this exists. */
export function escapeRawControlCharsInStrings(input: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (const ch of input) {
    if (inString) {
      if (escaped) {
        result += ch;
        escaped = false;
      } else if (ch === "\\") {
        result += ch;
        escaped = true;
      } else if (ch === '"') {
        inString = false;
        result += ch;
      } else if (ch === "\n") {
        result += "\\n";
      } else if (ch === "\r") {
        result += "\\r";
      } else if (ch === "\t") {
        result += "\\t";
      } else {
        result += ch;
      }
    } else {
      if (ch === '"') inString = true;
      result += ch;
    }
  }

  return result;
}
