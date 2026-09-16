import { NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { isValidUuid } from "@/lib/validate/input";

/**
 * Clears an activity's tutor conversation so a learner can start fresh with the tutor. Must
 * actually delete the rows, not just hide them client-side — /api/tutor always re-fetches
 * tutor_messages from Postgres on every turn (see lib/ai/tutor.ts's bounded history), so a
 * UI-only "clear" would leave the tutor still seeing the old conversation on the next message.
 *
 * Deliberately scoped to just the conversation, not the activity's own state/progress
 * (activity_events, last_state) — those are a separate concern the activity itself manages via
 * its own reset-style registered actions.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Invalid activity id." }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from("tutor_messages").delete().eq("activity_id", id);

  if (error) {
    return NextResponse.json({ error: "Could not clear the conversation." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
