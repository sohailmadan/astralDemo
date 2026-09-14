/**
 * The fixed contract every generated activity is compiled against, and the postMessage
 * protocol between the sandboxed iframe (this SDK, bundled into the generated code) and the
 * host page (components/activity/activity-frame.tsx). One file, imported by both sides, so
 * there's a single source of truth for the message shapes crossing that boundary.
 *
 * See CLAUDE.md "Generation: fixed contract" and "State is generic, not quiz-shaped" for why
 * this is deliberately unopinionated about what "state" means — it's whatever the activity's
 * author decides matters, plus a generic event log, never named fields like attempts/hints.
 */

// `initialState` lets a re-mounted activity (e.g. the learner leaving and coming back) restore
// exactly what publishState last reported, instead of always restarting from the generated
// code's own hardcoded defaults — see ENTRY_SOURCE in lib/validate/compile.ts for how this is
// populated (a `window` global set by the host BEFORE the bundle runs, read once at mount) and
// activity-frame.tsx for where activities.last_state feeds it. `null` when there's no prior
// state (a fresh activity) — undefined is never used so a real code check (`!= null`) is
// unambiguous.
export type ActivityProps = {
  initialState?: Record<string, unknown> | null;
};

export interface TutorBridge {
  /** Publish the activity's current meaningful state, whatever shape that is for this activity. */
  publishState(state: Record<string, unknown>): void;
  /** Append a discrete event to the durable log (e.g. "answer_submitted", "hint_requested"). */
  emitEvent(type: string, payload?: unknown): void;
  /** Register a named action the tutor is allowed to invoke on this activity. */
  registerAction(name: string, handler: (args: Record<string, unknown>) => void): void;
}

// --- postMessage protocol between the sandboxed iframe and the host page ---

export type ActivityToHostMessage =
  | { type: "READY" }
  | { type: "STATE_SNAPSHOT"; state: Record<string, unknown> }
  | { type: "EVENT"; eventType: string; payload: unknown }
  | { type: "ACTION_RESULT"; name: string; ok: boolean; error?: string }
  // Sent by the entry script (lib/validate/compile.ts's ENTRY_SOURCE), not by generated
  // activity code or the useTutorBridge SDK — host-rendering plumbing, not part of the
  // tutor-facing contract.
  | { type: "RESIZE"; height: number };

export type HostToActivityMessage = {
  type: "ACTION_CALL";
  name: string;
  args: Record<string, unknown>;
};
