import { NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";

const MAX_PAYLOAD_BYTES = 10_000;

/**
 * The only write path for `activity_events`/`activities.last_state` (see CLAUDE.md
 * "Security considerations" — neither table has a public RLS policy, so the browser never
 * writes to Postgres directly here, only through this service-role-mediated endpoint).
 *
 * Called by the host page (components/activity/activity-frame.tsx) whenever the sandboxed
 * iframe posts a STATE_SNAPSHOT or EVENT message — persistence and the live bridge are the
 * same event, not two separate features (see CLAUDE.md "AI tutor <-> activity interface").
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);

  if (!body || (body.kind !== "state" && body.kind !== "event")) {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  if (body.kind === "state") {
    const state = body.state;
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      return NextResponse.json({ error: "state must be an object." }, { status: 400 });
    }
    if (JSON.stringify(state).length > MAX_PAYLOAD_BYTES) {
      return NextResponse.json({ error: "state payload too large." }, { status: 413 });
    }

    const supabase = createServiceClient();
    const { error } = await supabase.from("activities").update({ last_state: state }).eq("id", id);
    if (error) return NextResponse.json({ error: "Could not store state." }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // body.kind === "event"
  const eventType = typeof body.eventType === "string" ? body.eventType.slice(0, 200) : "";
  if (!eventType) {
    return NextResponse.json({ error: "eventType is required." }, { status: 400 });
  }
  if (JSON.stringify(body.payload ?? null).length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: "payload too large." }, { status: 413 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("activity_events")
    .insert({ activity_id: id, type: eventType, payload: body.payload ?? null });

  if (error) return NextResponse.json({ error: "Could not store event." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
