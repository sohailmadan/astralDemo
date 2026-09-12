import { LangfuseSpanProcessor } from "@langfuse/otel";
import { registerOTel } from "@vercel/otel";

/**
 * Wires every AI SDK call's OpenTelemetry spans (enabled per-call via
 * `experimental_telemetry: { isEnabled: true }`, see lib/ai/generateActivity.ts) to Langfuse.
 * This is what lets the brief's "provide tracing for the important AI workflows" requirement
 * be satisfied by configuration rather than a bespoke tracer — see CLAUDE.md "Observability".
 *
 * `exportMode: "immediate"` (not the default "batched") matters specifically because this runs
 * on Vercel serverless: a function can be frozen/killed right after finishing its work, and a
 * batched processor waiting to flush would lose spans exactly the way `after()` can lose
 * unfinished work if not handled carefully (see CLAUDE.md's `after()` discussion) — the same
 * lesson applied to a different mechanism.
 */
export function register() {
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    // No keys configured (e.g. local dev without observability set up) — skip registration
    // rather than fail requests trying to export traces nowhere.
    return;
  }

  registerOTel({
    serviceName: "astral-challenge",
    spanProcessors: [
      new LangfuseSpanProcessor({
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        baseUrl: process.env.LANGFUSE_BASE_URL,
        exportMode: "immediate",
      }),
    ],
  });
}
