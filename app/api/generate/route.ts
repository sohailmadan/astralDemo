import { after } from "next/server";
import { NextResponse } from "next/server";

import { generateActivityCode } from "@/lib/ai/generateActivity";
import { MAX_REPAIR_ATTEMPTS } from "@/lib/generation-constants";
import { compileActivity, type CompileError } from "@/lib/sandbox/compile";
import { createServiceClient } from "@/lib/supabase/service";

// Sized against generateActivity.ts's measured 120s per-call timeout: 1 initial attempt + up
// to MAX_REPAIR_ATTEMPTS more (3 total) x 120s = 360s, plus compile overhead, with margin.
// Vercel Hobby caps functions at 60s regardless of this value — this pipeline needs a Pro plan
// (or Fluid Compute) to actually run in production; worth knowing at deploy time, not
// discovering it there. Named explicitly in the README as a real constraint, not glossed over.
export const maxDuration = 500;

const MAX_PROMPT_LENGTH = 500;

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

  after(() => runGenerationPipeline(activity.id, prompt));

  return NextResponse.json({ id: activity.id }, { status: 202 });
}

/**
 * generate -> validate -> repair loop (see CLAUDE.md "Generation: fixed contract"). Runs
 * inside `after()`, after the HTTP response has already gone back to the browser — this is
 * why the function must be kept alive by `after()` rather than a plain fire-and-forget call.
 */
async function runGenerationPipeline(activityId: string, prompt: string) {
  const supabase = createServiceClient();
  let priorAttempt: { code: string; error: string } | undefined;
  let lastFailure = "Generation failed for an unknown reason.";

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    // 1-indexed for display ("attempt 1 of 3", not "0 of 3") — written before the (slow) AI
    // call so the UI can show which attempt is in flight, not just "generating" undifferentiated.
    await supabase
      .from("activities")
      .update({ generation_attempt: attempt + 1 })
      .eq("id", activityId);

    try {
      const generation = await generateActivityCode(prompt, { priorAttempt });
      const compiled = await compileActivity(generation.code);

      if (compiled.ok) {
        await supabase
          .from("activities")
          .update({
            status: "ready",
            title: generation.title,
            code: generation.code,
            compiled_js: compiled.code,
            compiled_css: compiled.css,
            actions: generation.actions,
          })
          .eq("id", activityId);
        return;
      }

      lastFailure = formatCompileErrors(compiled.errors);
      priorAttempt = { code: generation.code, error: lastFailure };
    } catch (err) {
      // A generation-call-level failure (timeout, malformed JSON the repair hook couldn't fix)
      // has no `code` to hand back as a prior attempt — next loop iteration retries fresh
      // against the original prompt rather than repairing something that doesn't exist.
      lastFailure = err instanceof Error ? err.message : String(err);
      priorAttempt = undefined;
    }
  }

  await supabase
    .from("activities")
    .update({ status: "failed", error: lastFailure })
    .eq("id", activityId);
}

function formatCompileErrors(errors: CompileError[]): string {
  return errors
    .map((e) => `${e.file ?? "Activity.tsx"}:${e.line ?? "?"}:${e.column ?? "?"} — ${e.message}`)
    .join("\n");
}
