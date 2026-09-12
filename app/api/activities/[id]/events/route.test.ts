import { describe, expect, it } from "bun:test";

import { POST } from "./route";

// Only the validation paths that return before ever touching Supabase — these must stay fast
// and network-free. The success path (a real insert/upsert) is covered by manual verification
// against the live database (see the commit history) rather than a unit test that would need
// a real or mocked Supabase client either way.
function request(body: unknown) {
  return new Request("http://localhost/api/activities/test-id/events", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
const params = Promise.resolve({ id: "test-id" });

describe("POST /api/activities/[id]/events", () => {
  it("rejects a body with no recognized kind", async () => {
    const res = await POST(request({ kind: "bogus" }), { params });
    expect(res.status).toBe(400);
  });

  it("rejects an unparseable body", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: "not json" }), { params });
    expect(res.status).toBe(400);
  });

  it("rejects a state payload that isn't a plain object", async () => {
    const res = await POST(request({ kind: "state", state: "not an object" }), { params });
    expect(res.status).toBe(400);
  });

  it("rejects a state payload that's an array (not a plain object)", async () => {
    const res = await POST(request({ kind: "state", state: [1, 2, 3] }), { params });
    expect(res.status).toBe(400);
  });

  it("rejects an event with no eventType", async () => {
    const res = await POST(request({ kind: "event", payload: { x: 1 } }), { params });
    expect(res.status).toBe(400);
  });

  it("rejects an oversized state payload", async () => {
    const hugeState = { blob: "x".repeat(20_000) };
    const res = await POST(request({ kind: "state", state: hugeState }), { params });
    expect(res.status).toBe(413);
  });

  it("rejects an oversized event payload", async () => {
    const res = await POST(
      request({ kind: "event", eventType: "hint_requested", payload: { blob: "x".repeat(20_000) } }),
      { params },
    );
    expect(res.status).toBe(413);
  });
});
