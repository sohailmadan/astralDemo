import { describe, expect, it } from "bun:test";

import { computeProgressSummary } from "./tutor";
import type { ActivityEvent } from "../types";

function event(type: string): ActivityEvent {
  return { id: "e1", activity_id: "a1", type, payload: null, created_at: new Date().toISOString() };
}

describe("computeProgressSummary", () => {
  it("says nothing has happened yet for an empty log", () => {
    expect(computeProgressSummary([])).toContain("hasn't interacted");
  });

  it("counts a single event type", () => {
    const summary = computeProgressSummary([event("hint_requested")]);
    expect(summary).toContain("hint requested: 1");
  });

  it("aggregates multiple occurrences of the same type, not one entry per event", () => {
    const summary = computeProgressSummary([
      event("hint_requested"),
      event("hint_requested"),
      event("hint_requested"),
    ]);
    expect(summary).toContain("hint requested: 3");
    // Should be one aggregated entry, not three separate mentions.
    expect(summary.match(/hint requested/g)?.length).toBe(1);
  });

  it("reports every distinct event type present, generic to whatever the activity emits", () => {
    // Deliberately not quiz-shaped fields (attempts/correctness) — this activity emits its own
    // vocabulary (point_moved), and the summary must not assume a fixed schema.
    const summary = computeProgressSummary([event("point_moved"), event("point_moved"), event("challenge_reset")]);
    expect(summary).toContain("point moved: 2");
    expect(summary).toContain("challenge reset: 1");
  });
});
