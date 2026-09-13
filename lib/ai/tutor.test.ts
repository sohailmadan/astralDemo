import { describe, expect, it } from "bun:test";

import { buildActionInputSchema, computeProgressSummary } from "./tutor";
import type { ActivityEvent } from "../types";

function event(type: string, payload: unknown = null): ActivityEvent {
  return { id: "e1", activity_id: "a1", type, payload, created_at: new Date().toISOString() };
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

  it("reports a right/wrong split when an event's payload carries a boolean 'correct' field", () => {
    const summary = computeProgressSummary([
      event("digit_submitted", { correct: true }),
      event("digit_submitted", { correct: false }),
      event("digit_submitted", { correct: true }),
    ]);
    expect(summary).toContain("digit submitted: 3 (2 correct, 1 incorrect");
  });

  // This is the "backwards" signal directly: 3 attempts total could mean "getting there" or
  // "regressed after getting it right once" — only the most recent outcome disambiguates them.
  it("reports the most recent outcome separately from the overall count", () => {
    const summary = computeProgressSummary([
      event("digit_submitted", { correct: true }),
      event("digit_submitted", { correct: false }),
    ]);
    expect(summary).toContain("most recent was incorrect");
  });

  it("does not fabricate a right/wrong split for an event with no 'correct' field", () => {
    const summary = computeProgressSummary([event("point_moved", { x: 1, y: 2 })]);
    expect(summary).toContain("point moved: 1");
    expect(summary).not.toContain("correct");
  });
});

describe("buildActionInputSchema", () => {
  it("builds an empty schema for a zero-argument action", () => {
    const schema = buildActionInputSchema([]);
    expect(schema.safeParse({}).success).toBe(true);
  });

  it("builds an empty schema when args is undefined (rows generated before this field existed)", () => {
    const schema = buildActionInputSchema(undefined);
    expect(schema.safeParse({}).success).toBe(true);
  });

  // Regression test: this is exactly the bug found on a live "provide_hint" action — an empty
  // schema meant the tutor could only ever call it with {}, so the hint box rendered with no
  // hint text, even though the model wanted to fill one in.
  it("gives a declared arg its own field in the schema", () => {
    const schema = buildActionInputSchema([{ name: "hint", description: "The hint text to show." }]);
    const result = schema.safeParse({ hint: "Try dividing the first digit." });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).hint).toBe("Try dividing the first digit.");
    }
  });

  it("keeps a declared arg optional, so the model isn't forced to fill it in every time", () => {
    const schema = buildActionInputSchema([{ name: "hint", description: "The hint text to show." }]);
    expect(schema.safeParse({}).success).toBe(true);
  });

  // Regression test: a real production failure had the codegen model substitute {name, type}
  // for our {name, description} arg shape — description missing entirely. Still needs to build
  // a usable schema rather than fail, since the arg's own name is a reasonable fallback label.
  it("still builds a usable field when an arg's description is missing", () => {
    const schema = buildActionInputSchema([{ name: "hint" }]);
    const result = schema.safeParse({ hint: "Divide 4 by 12." });
    expect(result.success).toBe(true);
  });
});
