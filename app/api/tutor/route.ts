import { NextResponse } from "next/server";

import { getTutorReply } from "@/lib/ai/tutor";
import { createServiceClient } from "@/lib/supabase/service";
import type { Activity, ActivityEvent, TutorMessage } from "@/lib/types";

const MAX_MESSAGE_LENGTH = 1000;
const HISTORY_FETCH_LIMIT = 20; // matches lib/ai/tutor.ts's MAX_HISTORY_MESSAGES

/**
 * One tutor turn: fetch context (activity + events + bounded history), call the model,
 * persist both the learner's message and the reply, return the reply for the client to
 * display and (if it carries an action call) forward into the iframe over the postMessage
 * bridge. See CLAUDE.md "AI tutor <-> activity interface" for the full context-assembly
 * contract this implements.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const activityId = typeof body?.activityId === "string" ? body.activityId : "";
  const message = typeof body?.message === "string" ? body.message.trim() : "";

  if (!activityId || !message || message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: "A valid activityId and message are required." }, { status: 400 });
  }

  const supabase = createServiceClient();

  const [{ data: activity, error: activityError }, { data: events, error: eventsError }, { data: history, error: historyError }] =
    await Promise.all([
      supabase.from("activities").select("*").eq("id", activityId).single(),
      supabase
        .from("activity_events")
        .select("*")
        .eq("activity_id", activityId)
        .order("created_at", { ascending: true }),
      supabase
        .from("tutor_messages")
        .select("*")
        .eq("activity_id", activityId)
        .order("created_at", { ascending: false })
        .limit(HISTORY_FETCH_LIMIT),
    ]);

  if (activityError || !activity) {
    return NextResponse.json({ error: "Activity not found." }, { status: 404 });
  }
  if (activity.status !== "ready") {
    return NextResponse.json({ error: "Activity isn't ready yet." }, { status: 409 });
  }
  if (eventsError || historyError) {
    return NextResponse.json({ error: "Could not load activity context." }, { status: 500 });
  }

  const orderedHistory = [...((history as TutorMessage[]) ?? [])].reverse();

  let reply;
  try {
    reply = await getTutorReply({
      activity: activity as Activity,
      events: (events as ActivityEvent[]) ?? [],
      history: orderedHistory,
      userMessage: message,
    });
  } catch (err) {
    // A model-call failure (rate limit, timeout, provider error) here should read as an honest
    // "couldn't reach the tutor" to the learner, not a bare framework 500 with no message —
    // and it must not still write a user/assistant pair to tutor_messages for a reply that
    // never happened.
    const cause = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Tutor call failed: ${cause}` }, { status: 502 });
  }

  // Only forward an action call the activity actually registered — defense in depth on top of
  // the tool schema the model was constrained to (see CLAUDE.md "Security considerations").
  const validActionNames = new Set((activity as Activity).actions.map((a) => a.name));
  const actionCall =
    reply.actionCall && validActionNames.has(reply.actionCall.name) ? reply.actionCall : undefined;

  const { error: insertError } = await supabase.from("tutor_messages").insert([
    { activity_id: activityId, role: "user", content: message },
    { activity_id: activityId, role: "assistant", content: reply.content, action_call: actionCall ?? null },
  ]);

  if (insertError) {
    return NextResponse.json({ error: "Could not save the conversation." }, { status: 500 });
  }

  return NextResponse.json({ content: reply.content, actionCall });
}
