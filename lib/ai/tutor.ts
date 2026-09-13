import { generateText, tool } from "ai";
import { z } from "zod";

import { traceGeneration } from "../trace";
import type { Activity, ActivityActionArg, ActivityEvent, TutorMessage } from "../types";
import { effectiveModelId, TUTOR_MODEL, tutorModel } from "./openrouter";

// Same shape as the generation repair loop's bound (see CLAUDE.md "AI tutor <-> activity
// interface" / "Security considerations") — a long-running session's history is capped so a
// small free model's context window and latency stay predictable; state visibility comes from
// the always-fresh last_state + progress summary below, not from re-sending everything ever said.
const MAX_HISTORY_MESSAGES = 20;

const SYSTEM_PROMPT_HEADER = `You are a warm, encouraging AI tutor. You can see this activity's current state and everything the learner has done in it so far, and you can invoke the actions listed below to actually affect the activity — not just talk about it.

Rules:
- Never re-ask or restate something the progress summary below already tells you.
- If the learner got something wrong, ask them to walk through their thinking first ("what made you pick that?") rather than immediately giving the correct answer — Socratic, not answer-dispensing.
- Keep responses short and concrete. This is a chat, not a lecture.
- Only invoke an action when it's clearly the right thing to do right now, never just to seem responsive.
- Never claim to know something the state or progress summary below doesn't actually show.
- When asked for a hint or help, address ONLY the specific question/value in the current state
  below — never mention other steps, later parts of the problem, or the final answer. A hint
  that references something outside what's happening right now reads as confusing rather than
  helpful, since the learner has no way to tell if it's relevant to what they're stuck on.`;

/**
 * Turns the raw activity_events log into a short, cheap-to-compute plain-language summary —
 * far more legible to a small free model than a raw JSON event array, and exactly the
 * mechanism behind "the tutor knows how many hints were used" (see CLAUDE.md). Intentionally
 * generic: it counts whatever event types this activity actually emitted, it doesn't assume
 * quiz-shaped fields like "correct"/"attempts" exist.
 *
 * Where an event's payload DOES carry a boolean `correct` field (most activities'
 * answer/digit-submission events do, even though the contract never requires it), the summary
 * also reports the right/wrong split and — separately — the outcome of the single most recent
 * occurrence, so the tutor can tell "3 attempts, 2 right" apart from "3 attempts, but the last
 * one was wrong" (a learner going backwards after getting it right once looks identical to one
 * who's simply slow without that last-outcome signal).
 */
export function computeProgressSummary(events: ActivityEvent[]): string {
  if (events.length === 0) {
    return "Progress so far: the learner hasn't interacted with the activity yet.";
  }

  const counts = new Map<string, number>();
  const correctCounts = new Map<string, { correct: number; incorrect: number }>();
  const lastOutcome = new Map<string, boolean>();

  for (const event of events) {
    counts.set(event.type, (counts.get(event.type) ?? 0) + 1);

    const payload = event.payload;
    if (payload && typeof payload === "object" && "correct" in payload) {
      const isCorrect = Boolean((payload as { correct: unknown }).correct);
      const entry = correctCounts.get(event.type) ?? { correct: 0, incorrect: 0 };
      if (isCorrect) entry.correct++;
      else entry.incorrect++;
      correctCounts.set(event.type, entry);
      lastOutcome.set(event.type, isCorrect); // events are in ascending order, so this ends up as the latest
    }
  }

  const parts = Array.from(counts.entries()).map(([type, count]) => {
    const label = type.replace(/_/g, " ");
    const outcome = correctCounts.get(type);
    if (!outcome) return `${label}: ${count}`;

    const last = lastOutcome.get(type);
    const lastNote = last === undefined ? "" : `, most recent was ${last ? "correct" : "incorrect"}`;
    return `${label}: ${count} (${outcome.correct} correct, ${outcome.incorrect} incorrect${lastNote})`;
  });

  return `Progress so far — ${parts.join(", ")}.`;
}

function buildSystemPrompt(activity: Activity, progressSummary: string): string {
  const actionsList = activity.actions.length
    ? activity.actions
        .map((a) => `- ${a.name}: ${a.description ?? "(no description provided)"}`)
        .join("\n")
    : "(this activity registered no actions — you can only discuss it, not act on it)";

  return `${SYSTEM_PROMPT_HEADER}

Activity: "${activity.title ?? activity.prompt}"
Learner's original request: "${activity.prompt}"

Current state: ${JSON.stringify(activity.last_state ?? {})}

${progressSummary}

Actions you can invoke on this activity:
${actionsList}`;
}

export interface TutorReply {
  content: string;
  actionCall?: { name: string; args: Record<string, unknown> };
}

// Every declared arg is modeled as an optional string — loose on purpose. The generation
// contract only asks the codegen model for a plain-language description per arg, not a real
// type, so a string the tutor fills in from that description is the most it can reliably
// produce; a genuinely numeric/boolean argument would still arrive as a string the generated
// handler must parse itself. Real limitation, no longer "no schema at all" (which produced
// empty {} args for every action, including ones whose handler needed real content — found
// directly on a live "provide_hint" action that rendered its hint box with no hint text).
export function buildActionInputSchema(args?: ActivityActionArg[]) {
  if (!args || args.length === 0) return z.object({});
  return z.object(
    Object.fromEntries(
      // Falls back to the arg's own name when description is missing — a real model has been
      // observed omitting it (substituting its own {name, type} shape instead), and the tool
      // still needs SOME text to describe the field by, even if less specific than intended.
      args.map((arg) => [arg.name, z.string().optional().describe(arg.description ?? arg.name)]),
    ),
  );
}

/**
 * One tutor turn: assembles context fresh (system prompt regenerated from current
 * state/progress every call — never cached, since both change turn to turn) and calls the
 * model with tools built from the activity's own registered actions, so a tool call is
 * schema-checked before it can ever reach the sandboxed iframe.
 */
export async function getTutorReply(params: {
  activity: Activity;
  events: ActivityEvent[];
  history: TutorMessage[];
  userMessage: string;
}): Promise<TutorReply> {
  const { activity, events, history, userMessage } = params;

  const system = buildSystemPrompt(activity, computeProgressSummary(events));

  const tools = Object.fromEntries(
    activity.actions.map((action) => [
      action.name,
      tool({
        description: action.description ?? `Invokes the "${action.name}" action on this activity.`,
        inputSchema: buildActionInputSchema(action.args),
      }),
    ]),
  );

  const messages = [
    ...history.slice(-MAX_HISTORY_MESSAGES).map((m) => ({ role: m.role, content: m.content }) as const),
    { role: "user" as const, content: userMessage },
  ];

  const result = await traceGeneration(
    { name: "tutor-turn", model: effectiveModelId(TUTOR_MODEL, "tutor"), input: { system, messages } },
    () =>
      generateText({
        model: tutorModel(),
        system,
        messages,
        tools: Object.keys(tools).length > 0 ? tools : undefined,
        abortSignal: AbortSignal.timeout(120_000),
      }),
  );

  const call = result.toolCalls?.[0];
  return {
    content: result.text || (call ? `Done.` : "Sorry, I didn't catch that — could you rephrase?"),
    actionCall: call ? { name: call.toolName, args: (call.input ?? {}) as Record<string, unknown> } : undefined,
  };
}
