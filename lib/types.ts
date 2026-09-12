/**
 * Shared types for the `activities` row and the pieces that hang off it.
 * Mirrors the Postgres schema in supabase/migrations — see CLAUDE.md for why the shape is
 * generic (state/events) rather than quiz-specific (attempts/correctness fields).
 */

export type ActivityStatus = "generating" | "ready" | "failed";

export interface ActivityAction {
  name: string;
  description: string;
}

export interface Activity {
  id: string;
  prompt: string;
  status: ActivityStatus;
  title: string | null;
  code: string | null;
  actions: ActivityAction[];
  last_state: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export type TutorRole = "user" | "assistant";

export interface TutorActionCall {
  name: string;
  args: Record<string, unknown>;
}

export interface TutorMessage {
  id: string;
  activity_id: string;
  role: TutorRole;
  content: string;
  action_call: TutorActionCall | null;
  created_at: string;
}

export interface ActivityEvent {
  id: string;
  activity_id: string;
  type: string;
  payload: unknown;
  created_at: string;
}
