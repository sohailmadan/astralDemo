#!/usr/bin/env bun
/**
 * Executable eval provider for promptfoo (see evals/tutor.eval.yaml). Called once per test
 * case with a JSON fixture as argv[2] — {activity, events, history, userMessage} — and runs
 * the real lib/ai/tutor.ts (the exact same context-assembly/tool-calling code /api/tutor
 * uses, not a reimplementation). Fixtures stand in for what a real Postgres row would be,
 * since these tests need to hold state/events/history fixed to check specific behavior
 * (Socratic-on-wrong, state-grounding, action-calling) rather than depend on whatever a prior
 * eval run happened to leave in the database.
 *
 * Run via `bun run evals/run-tutor.ts '<fixture json>'`.
 */
import { getTutorReply } from "../lib/ai/tutor";
import type { Activity, ActivityAction, ActivityEvent, TutorMessage } from "../lib/types";

interface Fixture {
  title?: string;
  prompt: string;
  actions?: ActivityAction[];
  lastState?: Record<string, unknown>;
  events?: { type: string; payload?: unknown }[];
  history?: { role: "user" | "assistant"; content: string }[];
  userMessage: string;
}

const fixtureJson = process.argv[2];
if (!fixtureJson) {
  console.error("Usage: run-tutor.ts '<fixture json>'");
  process.exit(1);
}

const fixture = JSON.parse(fixtureJson) as Fixture;
const now = new Date().toISOString();

const activity: Activity = {
  id: "eval-fixture",
  prompt: fixture.prompt,
  status: "ready",
  title: fixture.title ?? fixture.prompt,
  code: null,
  compiled_js: null,
  compiled_css: null,
  actions: fixture.actions ?? [],
  generation_attempt: 1,
  last_state: fixture.lastState ?? null,
  error: null,
  created_at: now,
  updated_at: now,
};

const events: ActivityEvent[] = (fixture.events ?? []).map((e, i) => ({
  id: `eval-event-${i}`,
  activity_id: activity.id,
  type: e.type,
  payload: e.payload ?? null,
  created_at: now,
}));

const history: TutorMessage[] = (fixture.history ?? []).map((m, i) => ({
  id: `eval-history-${i}`,
  activity_id: activity.id,
  role: m.role,
  content: m.content,
  action_call: null,
  created_at: now,
}));

const reply = await getTutorReply({ activity, events, history, userMessage: fixture.userMessage });
console.log(JSON.stringify(reply));
