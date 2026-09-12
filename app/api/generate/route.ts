import { after } from "next/server";
import { NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";

export const maxDuration = 60;

const MAX_PROMPT_LENGTH = 500;

// Milestone 1 stub: proves insert -> return immediately -> after() -> update works end to end,
// before any real generation logic exists. Milestone 2 replaces the body of the after()
// callback with the actual generate -> validate -> repair pipeline (see CLAUDE.md).
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";

  if (!prompt || prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json({ error: "A valid prompt is required." }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: activity, error } = await supabase
    .from("activities")
    .insert({ prompt, status: "generating" })
    .select("id")
    .single();

  if (error || !activity) {
    return NextResponse.json({ error: "Could not start generation." }, { status: 500 });
  }

  after(async () => {
    // Placeholder work standing in for the real pipeline until Milestone 2.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await supabase
      .from("activities")
      .update({
        status: "ready",
        title: prompt,
        code: "// placeholder — real generation lands in Milestone 2",
        actions: [],
      })
      .eq("id", activity.id);
  });

  return NextResponse.json({ id: activity.id }, { status: 202 });
}
