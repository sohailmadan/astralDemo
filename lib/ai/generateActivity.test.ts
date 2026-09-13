import { describe, expect, it } from "bun:test";

import { inferMissingActionArgs } from "./generateActivity";

describe("inferMissingActionArgs", () => {
  it("leaves an action with already-declared args untouched", () => {
    const code = `bridge.registerAction('provide_hint', payload => setHint(payload.hint));`;
    const actions = [
      { name: "provide_hint", description: "Shows a hint.", args: [{ name: "hint", description: "explicit" }] },
    ];
    const result = inferMissingActionArgs(code, actions);
    expect(result[0].args).toEqual([{ name: "hint", description: "explicit" }]);
  });

  // Regression test: this is the exact pattern found THREE separate times in production — the
  // model declares the action but omits `args` even though its own handler reads payload.hint,
  // producing a hint box with no hint text since the tutor's tool schema was empty.
  it("infers a missing arg from the handler's own payload.<field> access", () => {
    const code = `bridge.registerAction('provide_hint', payload => setHint(payload.hint));`;
    const actions = [{ name: "provide_hint", description: "Shows a hint." }];
    const result = inferMissingActionArgs(code, actions);
    expect(result[0].args).toEqual([
      { name: "hint", description: expect.stringContaining("payload.hint") as unknown as string },
    ]);
  });

  it("handles the optional-chaining payload?.<field> variant", () => {
    const code = `bridge.registerAction('give_hint', payload => setHint(payload?.hint));`;
    const actions = [{ name: "give_hint", description: "Shows a hint." }];
    const result = inferMissingActionArgs(code, actions);
    expect(result[0].args?.map((a) => a.name)).toEqual(["hint"]);
  });

  it("leaves a genuinely zero-argument action alone (no payload access found)", () => {
    const code = `bridge.registerAction('reset', () => { setCount(0); });`;
    const actions = [{ name: "reset", description: "Resets the count." }];
    const result = inferMissingActionArgs(code, actions);
    expect(result[0].args).toBeUndefined();
  });

  it("does not confuse two different actions' payload fields with each other", () => {
    const code = `
      bridge.registerAction('provide_hint', payload => setHint(payload.hint));
      bridge.registerAction('set_target', payload => setTarget(payload.value));
    `;
    const actions = [
      { name: "provide_hint", description: "Shows a hint." },
      { name: "set_target", description: "Sets a new target." },
    ];
    const result = inferMissingActionArgs(code, actions);
    expect(result[0].args?.map((a) => a.name)).toEqual(["hint"]);
    expect(result[1].args?.map((a) => a.name)).toEqual(["value"]);
  });

  it("leaves an action alone if its name isn't found in a registerAction call at all", () => {
    const code = `// no registerAction calls in this snippet`;
    const actions = [{ name: "mystery_action", description: "Does something." }];
    const result = inferMissingActionArgs(code, actions);
    expect(result[0].args).toBeUndefined();
  });
});
