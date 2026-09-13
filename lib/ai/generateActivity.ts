import { generateObject } from "ai";
import { z } from "zod";

import { traceGeneration } from "../trace";
import { CODEGEN_MODEL, codegenModel } from "./openrouter";

export const ActivityGenerationSchema = z.object({
  title: z
    .string()
    .describe("Short, human-readable title shown in the activity list."),
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
const SYSTEM_PROMPT = `PEDAGOGICAL GOAL:

The activity must TEACH through interaction, not explain the topic and then test it.

Assume the learner knows nothing. Do NOT put the lesson in paragraphs, definitions,
examples, or a "What is X?" section before the interaction. The learner must discover
the idea by manipulating the activity.

Every important concept introduced must immediately be connected to an interaction.

For example, when teaching prime numbers, do NOT begin with:
"A prime number has exactly two factors..."
Instead, give the learner a number and let them interactively find/check its factors.
Then use what they discovered to help them notice the pattern that defines a prime.

Use this learning loop:

OBSERVE → PREDICT/CHOOSE → INTERACT → SEE RESULT → UNDERSTAND → TRY AGAIN

Start with a very simple example that makes the concept discoverable. Guide the learner
one small step at a time, then gradually remove the guidance and let them apply the idea
independently.

For procedural concepts, never start with "solve this." Build the first example together:
show the current state, ask what to do next, let the learner perform it, then show the
BEFORE → ACTION → AFTER result and briefly explain why.

The screen should primarily be an interactive workspace, not a document.

At any moment the learner should know:
- what they are trying to discover,
- what they can interact with,
- what changed because of their action,
- and what that change tells them.

Do not consider an activity educational merely because it has buttons, a quiz, hints,
or feedback. If all interaction were removed, the remaining content should NOT already
contain the lesson's complete explanation.

Hints should reveal the next useful observation or action, not dump the answer.

After the learner discovers the concept through a guided example, give them a new example
with less scaffolding so they demonstrate that they actually learned it.
IMPORTANT: An activity is not considered educational merely because it has buttons,
feedback, hints, or a final answer. The sequence of interactions itself must help a
beginner discover and understand the concept.

CONTRACT — the generated code must follow this exactly:

1. Export a single default function component taking no required props:
   \`export default function Activity() { ... }\`

2. You MUST include BOTH of these import statements at the top of the file, always, even if
   it looks obvious from context that they're needed — they are not automatically available:
   \`import { useState, useEffect /* + whatever else you use */ } from "react";\`
   \`import { useTutorBridge } from "./activity-sdk";\`
   These are also the ONLY imports allowed — no other npm packages, no CSS imports. Everything
   else must be built from plain React + Tailwind utility classes. Omitting either required
   import is a hard failure: the activity will build without error but crash the instant it
   runs, showing the learner nothing at all.

3. Call \`const bridge = useTutorBridge()\` and use it to stay connected to the tutor:
   - \`bridge.publishState(state)\` — call this whenever the activity's meaningful state
     changes (state is a plain object, whatever shape makes sense for THIS activity — do not
     force in fields like "attempts" or "correct" if they don't naturally apply). This is the
     ONLY way the tutor sees what's happening — it cannot see the rendered screen. Always
     include: (a) the specific value/question currently being asked, in a form that doesn't
     require re-deriving it (e.g. "How many times does 12 go into 43?", not just a step index —
     a step index alone forces the tutor to redo your whole computation itself to know what's
     actually being asked, which it will get wrong), (b) whatever the learner has currently
     typed/selected/positioned, even before they submit it, and (c) the most recent feedback or
     correctness result the activity itself displayed. Without (b) and (c), the tutor can only
     ever discuss the step number, not what the learner is actually stuck on or already tried.
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

OUTPUT FORMAT — read this carefully, it is a common source of failure:

Return a single JSON object matching the schema exactly: \`title\` (string), \`code\` (string —
the full TSX source), \`actions\` (array). Nothing else — no prose before or after the JSON, no
markdown code fence around it.

The \`code\` field is a JSON STRING containing your TSX source, not literal TSX. Every line break
inside it MUST be the two-character escape sequence \\n — never a real, literal newline
character. The same applies to any literal tab or double-quote character inside that string.
This matters most at the edges of JS template literals (backtick strings with \${...}
interpolation) inside your generated code — that is exactly where a literal newline is most
likely to slip in by mistake instead of the escaped \\n, which breaks the JSON itself even when
the TSX source you intended is completely correct.`;

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
      model: modelId,
      input: { system: SYSTEM_PROMPT, prompt: userContent },
    },
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
        repairText: repairModelJson,
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
  const allCallPositions = Array.from(code.matchAll(/registerAction\s*\(\s*['"][^'"]+['"]/g)).map(
    (m) => m.index,
  );

  return actions.map((action) => {
    if (action.args && action.args.length > 0) return action;

    const registerCallPattern = new RegExp(
      `registerAction\\s*\\(\\s*['"]${escapeRegExp(action.name)}['"]`,
    );
    const match = registerCallPattern.exec(code);
    if (!match) return action;

    const windowEnd = allCallPositions.find((pos) => pos > match.index) ?? code.length;
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
