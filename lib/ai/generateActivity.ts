import { generateObject } from "ai";
import { z } from "zod";

import { traceGeneration } from "../trace";
import { codegenModel, effectiveModelId, OPENAI_CODEGEN_MODEL } from "./openrouter";

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

If the concept itself has a real, concrete thing the learner could directly manipulate to explore
it — a line, a shape, an object, a diagram, anything with a position, size, or value that visibly
changes — you MUST render that actual thing and let the learner act on it directly (drag it, click
it, adjust it). A text question ABOUT that thing (e.g. "what is the slope of this line?" with no
line ever drawn) is never a substitute for giving them the real thing to work with, no matter what
the specific topic is — this is a general rule about every topic that has a natural visual or
manipulable form, not a list of specific cases to check against.

Whatever you draw must actually render the way you intend — a grid must look like faint grid
lines, not a solid block of color; a shape must look like that shape, not something else entirely.
Before finalizing any visual element, reason through how it will actually paint (what's filled vs.
outlined, what sits on top of what, whether it fits the space) rather than assuming a technique
works because it's common. When you're not fully certain how something will render, prefer the
simplest, most predictable way to draw it over a cleverer one you're unsure about.

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

If the activity has a running/cumulative value (a total, a marker's position, a score-so-far),
every step must read that value from your actual state — never a separate hardcoded number you
wrote into the step script. The next step's prompt and any on-screen marker/highlight must always
agree with each other and with what the learner actually just did; if they'd ever disagree, that's
a bug in how you're tracking state, not something to reconcile with more text.

Show only ONE step at a time — never the whole list of steps up front, and never a preview/summary
that reveals a step's answer (a computed value, the correct choice, the final result, etc.) before
the learner has actually submitted their own attempt at it. As a mechanical check on this: any
value you compute to check an answer against (the correct digit, the target result, whatever
you'd compare the learner's input to) may only ever live in a JS variable used for that
comparison — never as literal text sitting in the JSX you return unconditionally. It's fine to
reveal it in feedback text that only renders AFTER a real check/submit happens; it is never fine
for it to already be sitting on screen, visible, before the learner has tried.

Never offer a "reveal answer" shortcut the learner can click to see the answer directly — giving
that away is the AI tutor's judgment call to make (via a real action it invokes), not a button the
activity hands the learner.

The AI tutor is a second, essential surface: it should be able to actually do things inside the
activity when the learner asks for help — not just talk. Whatever actions make sense for this
topic must be real \`registerAction\` calls, not just chat replies.

Only text that actually teaches the concept belongs in what you render — a title, a question, an
input, feedback. Nothing else, no matter its source or phrasing: not internal plumbing (event
names, state shape, action names), not commentary about the tutor or what it can do, and not your
own working notes toward satisfying this contract (what a value is "expected" to be, that
something is "shown to the tutor", a restated "current question (for your reference)" echoing
what you're already sending via publishState). If a sentence exists to help YOU implement the
contract or to explain the tutor rather than to teach the learner, it does not belong in the JSX
you return — work it out in a comment or a variable, never a line of rendered UI. As a hard,
mechanical check on this: the literal word "tutor" must never appear in any text you render to
the learner. If you're about to type it, you're describing the tutor instead of teaching — cut
that sentence or rephrase it around what the learner does (e.g. "Need a hint?", not "ask the
tutor for a hint").

Feedback must always reflect the learner's CURRENT input, not a stale judgment left over from a
previous attempt. If they change a value after submitting (drag to a new position, edit an
answer, pick a different choice) without resubmitting, clear the old feedback — never leave text
on screen judging a value that's no longer what's shown.

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
     "hint_requested"). Whenever an "answer_submitted"-style event has a right/wrong outcome,
     the payload MUST include a boolean field named exactly \`correct\` — never a differently-named
     field like \`expected\` or \`isRight\` instead. The tutor's own progress tracking looks for
     that exact key; a different name silently makes your activity's right/wrong history
     invisible to it, even though the data is technically there.
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
   like bg-primary. Layout must genuinely work at a ~375px phone width, not just desktop: use
   relative/flex/grid sizing, never a fixed pixel width wider than that on any element (an SVG/
   canvas included — give it a responsive \`viewBox\` and \`width="100%"\`, not a fixed pixel
   width). A row of buttons that doesn't fit must wrap onto multiple full-width rows, never
   wrap text awkwardly inside one narrow button while a sibling gets clipped off-screen.

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

  const modelId = opts?.model ?? OPENAI_CODEGEN_MODEL;
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
        // 90s per attempt. With reasoningEffort: "low" below, every real call measured against
        // this exact system prompt finished in 50-66s (multiple runs, both the isolated model
        // call and the full generateActivityCode pipeline) — 90s is ~40% headroom above the
        // slowest of those, not a guess. (An earlier version of this comment set 180s, sized
        // before reasoningEffort was tuned down from its slow default — no longer the real
        // number, see that option's own comment below.) 3 attempts at 90s each is 4.5 minutes
        // worst case, rounded up in MAX_TOTAL_MINUTES (lib/generation-constants.ts, which this
        // must stay in sync with) — genuinely fits Vercel's 300s/5min Hobby ceiling even in that
        // rare worst case now, unlike the wider timeout this replaced.
        abortSignal: AbortSignal.timeout(90_000),
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
        //
        // reasoningEffort: "low" — found directly in production: gpt-5-mini's DEFAULT reasoning
        // effort against this system prompt's real size took 148s (still produced good output,
        // just slow) and, at least once, longer than the 180s timeout above outright. "low" cut
        // that to a reliable ~60s on the identical real prompt, with the same-quality full
        // output (verified directly, not assumed) — this system prompt is a fixed, mechanical
        // contract (see its own doc comment), not the kind of open-ended reasoning problem that
        // benefits from the model thinking longer. Only affects OpenAI's reasoning-model family;
        // ignored by the free-tier fallback model, which isn't a reasoning model.
        providerOptions: { openai: { strictJsonSchema: false, reasoningEffort: "low" } },
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
