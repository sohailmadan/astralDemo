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
