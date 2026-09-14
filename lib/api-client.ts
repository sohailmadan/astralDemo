/**
 * Thin client-side fetch helper — every browser -> our-own-API call in this app follows the
 * same shape (POST JSON, parse JSON, throw a readable Error on failure), so it lives here once
 * instead of being re-typed in each component. Server-to-server / server-to-provider calls
 * (OpenRouter, Supabase) are a different concern and don't go through this.
 */
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.error ?? "Something went wrong. Please try again.");
  }

  return res.json() as Promise<T>;
}

export function generateActivity(prompt: string) {
  return postJson<{ id: string }>("/api/generate", { prompt });
}

/** Fire-and-forget: the activity's own render doesn't wait on this succeeding — see
 * activity-frame.tsx, which posts on every STATE_SNAPSHOT/EVENT the sandboxed iframe emits. */
function postActivityUpdate(activityId: string, body: unknown): void {
  void fetch(`/api/activities/${activityId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function postActivityState(activityId: string, state: Record<string, unknown>): void {
  postActivityUpdate(activityId, { kind: "state", state });
}

export function postActivityEvent(activityId: string, eventType: string, payload: unknown): void {
  postActivityUpdate(activityId, { kind: "event", eventType, payload });
}

async function deleteOk(url: string): Promise<boolean> {
  const res = await fetch(url, { method: "DELETE" });
  return res.ok;
}

/** Clears activity_events + last_state (see the DELETE handler's own doc comment for why this
 * is a separate concern from clearing the chat transcript). */
export function resetActivityProgress(activityId: string): Promise<boolean> {
  return deleteOk(`/api/activities/${activityId}/events`);
}

export function clearTutorMessages(activityId: string): Promise<boolean> {
  return deleteOk(`/api/activities/${activityId}/tutor-messages`);
}

export function sendTutorMessage(activityId: string, message: string) {
  return postJson<{ content: string; actionCall?: { name: string; args: Record<string, unknown> } }>(
    "/api/tutor",
    { activityId, message },
  );
}
