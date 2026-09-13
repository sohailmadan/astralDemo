import { Langfuse } from "langfuse";

/**
 * Direct HTTP-based Langfuse client — no OpenTelemetry involved. Three OTel-based approaches
 * were tried first (the AI SDK's own `telemetry: { isEnabled: true }` flag; `@langfuse/otel`'s
 * `LangfuseSpanProcessor` via `@vercel/otel`'s `registerOTel()`; a directly-built
 * `NodeTracerProvider` with `@langfuse/tracing`'s `startObservation`) — all three ran without
 * throwing, but no observation was verifiable afterward. This SDK sidesteps every question
 * about OTel global registration/provider resolution entirely: it's a plain HTTP client that
 * batches and POSTs directly to Langfuse's ingestion API. See CLAUDE.md "Observability" for
 * the full account.
 *
 * `undefined` if no keys are configured — callers should treat a `null` return as "tracing
 * disabled," not an error.
 */
let client: Langfuse | null | undefined;

function getClient(): Langfuse | null {
  if (client !== undefined) return client;
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    client = null;
    return client;
  }
  client = new Langfuse({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL,
  });
  return client;
}

/** Wraps an AI SDK call in a Langfuse generation — captures full input, output, model, tokens. */
export async function traceGeneration<T extends { usage?: unknown }>(
  params: { name: string; model: string; input: unknown },
  fn: () => Promise<T>,
): Promise<T> {
  const langfuse = getClient();
  if (!langfuse) return fn();

  const trace = langfuse.trace({ name: params.name });
  const generation = trace.generation({ name: params.name, model: params.model, input: params.input });

  try {
    const result = await fn();
    generation.end({
      output: "object" in result ? (result as { object: unknown }).object : result,
      usage: extractUsage(result.usage),
    });
    return result;
  } catch (err) {
    generation.end({
      level: "ERROR",
      statusMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    // Serverless-safe: nothing guarantees this process stays alive to batch-flush later, so
    // flush explicitly before returning rather than relying on a background timer.
    await langfuse.flushAsync();
  }
}

/**
 * Traces a non-LLM step (e.g. the esbuild/Tailwind compile step) as a Langfuse event — the
 * brief's Observability requirement asks specifically for "retries or repairs" and "errors" to
 * be inspectable, and a repair-loop attempt's compile result is exactly that, but it happens
 * entirely outside any AI SDK call, so traceGeneration above never sees it. Without this, a
 * genuine repair-loop failure (the model producing consistently bad code across all 3
 * attempts) was invisible in Langfuse — traceable only via server logs and the DB's
 * attempt_history, never alongside the generation call it followed.
 */
export async function traceEvent(params: {
  name: string;
  input?: unknown;
  output?: unknown;
  level?: "DEFAULT" | "ERROR";
  statusMessage?: string;
}): Promise<void> {
  const langfuse = getClient();
  if (!langfuse) return;

  const trace = langfuse.trace({ name: params.name });
  trace.event({
    name: params.name,
    input: params.input,
    output: params.output,
    level: params.level,
    statusMessage: params.statusMessage,
  });
  await langfuse.flushAsync();
}

function extractUsage(usage: unknown): { input?: number; output?: number; total?: number } | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const u = usage as Record<string, unknown>;
  const out: { input?: number; output?: number; total?: number } = {};
  if (typeof u.inputTokens === "number") out.input = u.inputTokens;
  if (typeof u.outputTokens === "number") out.output = u.outputTokens;
  if (typeof u.totalTokens === "number") out.total = u.totalTokens;
  return Object.keys(out).length > 0 ? out : undefined;
}
