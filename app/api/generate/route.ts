import { NoObjectGeneratedError } from "ai";
import { after } from "next/server";
import { NextResponse } from "next/server";

import { findUnregisteredActions, generateActivityCode } from "@/lib/ai/generateActivity";
import { CODEGEN_TIMEOUT_FALLBACK_MODEL } from "@/lib/ai/openrouter";
import { MAX_PROMPT_LENGTH, MAX_REPAIR_ATTEMPTS } from "@/lib/generation-constants";
import { createServiceClient } from "@/lib/supabase/service";
import { traceEvent } from "@/lib/trace";
import type { AttemptRecord } from "@/lib/types";
import { compileActivity, type CompileError } from "@/lib/validate/compile";
import { stripControlChars } from "@/lib/validate/input";

// Vercel's actual serverless ceiling on the Hobby plan (confirmed live via a real deploy
// attempt: "Serverless Functions must have a maxDuration between 1 and 300 for plan hobby" —
// 800 was rejected outright, not silently clamped). 3 attempts at generateActivity.ts's
// 180s-per-call timeout is 9 minutes worst case (see MAX_TOTAL_MINUTES in
// lib/generation-constants.ts) — over this 300s/5min ceiling in the rare worst case where every
// attempt needs a repair and each takes the full per-call timeout (Vercel kills the function
// mid-run then, leaving the row stuck in "generating" — a known gap, see README "What I'd
// improve"). The typical case (one attempt, tens of seconds with gpt-5-mini) is comfortably
// under it — that's what actually happens almost always. A Pro plan raises this to 800+.
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? stripControlChars(body.prompt.trim()) : "";

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
  const attemptHistory: AttemptRecord[] = [];
  // Which model the NEXT attempt should use — starts undefined (generateActivityCode's own
  // default, OPENAI_CODEGEN_MODEL / gpt-5-mini). Only ever changed on a timeout (see the catch
  // block below): retrying the exact same model risks hitting whatever made it slow again, so
  // the fallback is a genuinely different model, not another roll of the same dice. A
  // compile/content failure is a different kind of problem — the same model, fed its own error
  // back, is the intended repair path for that — so this is left alone everywhere else in the
  // loop.
  let nextModel: string | undefined;

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    const attemptNumber = attempt + 1;
    // 1-indexed for display ("attempt 1 of 3", not "0 of 3") — written before the (slow) AI
    // call so the UI can show which attempt is in flight, not just "generating" undifferentiated.
    await supabase
      .from("activities")
      .update({ generation_attempt: attemptNumber })
      .eq("id", activityId);

    try {
      const generation = await generateActivityCode(prompt, { priorAttempt, model: nextModel });
      const compiled = await compileActivity(generation.code);

      if (compiled.ok) {
        // Compiling and running successfully doesn't mean the tutor can actually DO anything —
        // found directly in production: an activity that compiled and rendered fine, but never
        // called bridge.registerAction() for any of the names it declared in `actions`. Treated
        // exactly like a compile failure (same repair-loop machinery, same attempt_history
        // shape) since the fix doesn't need a fresh generation, just wiring up the missing call.
        const unregistered = findUnregisteredActions(generation.code, generation.actions);
        if (unregistered.length > 0) {
          lastFailure = `Declared action(s) [${unregistered.join(", ")}] have no matching bridge.registerAction("<name>", ...) call anywhere in the code. Every name in \`actions\` must have an exact-match registerAction call — add the missing call(s), don't just remove the declaration.`;
          priorAttempt = { code: generation.code, error: lastFailure };
          attemptHistory.push({ attempt: attemptNumber, code: generation.code, error: lastFailure });
          console.error(
            `[generate] activity ${activityId} attempt ${attemptNumber}/${MAX_REPAIR_ATTEMPTS + 1} declared unregistered actions: ${unregistered.join(", ")}`,
          );
          await supabase.from("activities").update({ attempt_history: attemptHistory }).eq("id", activityId);
          continue;
        }

        attemptHistory.push({ attempt: attemptNumber, code: generation.code, error: null });
        await traceEvent({
          name: "compile-activity",
          input: { activityId, attempt: attemptNumber, code: generation.code },
          output: { ok: true, jsBytes: compiled.code.length, cssBytes: compiled.css.length },
        });
        await supabase
          .from("activities")
          .update({
            status: "ready",
            title: generation.title,
            code: generation.code,
            compiled_js: compiled.code,
            compiled_css: compiled.css,
            actions: generation.actions,
            attempt_history: attemptHistory,
          })
          .eq("id", activityId);
        return;
      }

      lastFailure = formatCompileErrors(compiled.errors);
      priorAttempt = { code: generation.code, error: lastFailure };
      attemptHistory.push({ attempt: attemptNumber, code: generation.code, error: lastFailure });
      // Visible in server stdout (and Vercel's function logs in production) the moment this
      // happens — the DB record (attempt_history below) is for structured querying later, this
      // is for noticing it right now without going to look. This is exactly the evidence
      // needed to tell "the model produced genuinely bad code" apart from "the prompt needs
      // work" apart from "this model just isn't reliable enough" — see CLAUDE.md "Reliability".
      console.error(
        `[generate] activity ${activityId} attempt ${attemptNumber}/${MAX_REPAIR_ATTEMPTS + 1} failed to compile:\n${lastFailure}\n--- generated code ---\n${generation.code}`,
      );
      // The compile step happens entirely outside any AI SDK call, so traceGeneration (which
      // only wraps the LLM call itself) never sees it — without this, a genuine repair-loop
      // failure was invisible in Langfuse, traceable only via server logs and the DB.
      await traceEvent({
        name: "compile-activity",
        input: { activityId, attempt: attemptNumber, code: generation.code },
        output: { ok: false, errors: compiled.errors },
        level: "ERROR",
        statusMessage: lastFailure,
      });
    } catch (err) {
      // A generation-call-level failure (timeout, malformed JSON the repair hook couldn't fix)
      // has no `code` to hand back as a prior attempt — next loop iteration retries fresh
      // against the original prompt rather than repairing something that doesn't exist.
      lastFailure = err instanceof Error ? err.message : String(err);
      priorAttempt = undefined;

      // A timeout means the model itself was too slow to answer at all, not that its answer
      // was wrong — retrying the exact same free-tier model just re-enters the same latency
      // variance again (see CODEGEN_MODEL's own comment: "60-120s+"). Switch the NEXT attempt
      // to the fallback model instead, once — if the fallback also times out, leave it there
      // rather than flapping back and forth for the remaining attempt.
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      if (isTimeout && nextModel !== CODEGEN_TIMEOUT_FALLBACK_MODEL) {
        nextModel = CODEGEN_TIMEOUT_FALLBACK_MODEL;
        console.error(`[generate] activity ${activityId} attempt ${attemptNumber} timed out — next attempt uses fallback model ${CODEGEN_TIMEOUT_FALLBACK_MODEL}`);
      }

      // NoObjectGeneratedError.text carries the model's actual raw output, which the generic
      // .message doesn't — without this, a schema-validation or unparseable-JSON failure was
      // undiagnosable after the fact: "response did not match schema" says nothing about WHAT
      // was wrong with it. Found the hard way: two consecutive real failures on this exact
      // error, and no way to tell (without adding this) whether the model's output was subtly
      // malformed JSON, missing a required field, or something else entirely.
      const rawOutput = NoObjectGeneratedError.isInstance(err) ? err.text : undefined;
      const loggedFailure = rawOutput ? `${lastFailure}\n--- raw model output ---\n${rawOutput}` : lastFailure;

      attemptHistory.push({ attempt: attemptNumber, code: null, error: loggedFailure });
      console.error(`[generate] activity ${activityId} attempt ${attemptNumber}/${MAX_REPAIR_ATTEMPTS + 1} errored: ${loggedFailure}`);
    }

    // Persisted after every attempt, not just at the end — if the process is killed mid-loop
    // (see CLAUDE.md's after() limitation), whatever attempts already ran stay inspectable
    // instead of vanishing along with the rest of the run.
    await supabase.from("activities").update({ attempt_history: attemptHistory }).eq("id", activityId);
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
