import { describe, expect, it } from "bun:test";

import {
  ActivityGenerationSchema,
  escapeRawControlCharsInStrings,
  findUnregisteredActions,
  inferMissingActionArgs,
} from "./generateActivity";

describe("ActivityGenerationSchema", () => {
  // Regression test: found directly in production — a response whose JSON was completely
  // valid (parsed fine) still failed schema validation because every action was missing its
  // own top-level `description` entirely, a field that was required until this fix. This is
  // the real payload shape observed, not a synthetic simplification.
  it("accepts an action with no description (the exact real-world failure)", () => {
    const result = ActivityGenerationSchema.safeParse({
      title: "Equivalent Fractions",
      code: "export default function Activity() { return null; }",
      actions: [
        { name: "provide_hint", args: [{ name: "hint", type: "string" }] },
        { name: "reset", args: [] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("still requires title and code", () => {
    const result = ActivityGenerationSchema.safeParse({ actions: [] });
    expect(result.success).toBe(false);
  });
});

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

describe("findUnregisteredActions", () => {
  it("returns nothing when every declared action has a matching registerAction call", () => {
    const code = `
      bridge.registerAction('reset', () => {});
      bridge.registerAction('provide_hint', payload => setHint(payload.hint));
    `;
    const actions = [{ name: "reset" }, { name: "provide_hint" }];
    expect(findUnregisteredActions(code, actions)).toEqual([]);
  });

  // Regression test: this is the exact bug found in production — a small local codegen model
  // listed action names that were never actually registered anywhere (it had treated `actions`
  // as a list of its own internal click-handler names), so the activity compiled and ran fine
  // but the tutor got "Unknown action" on every single attempt to invoke one.
  it("flags a declared action with no matching registerAction call anywhere", () => {
    const code = `
      const submit = () => { setResult(compute()); };
      const handleAngle1Change = (e) => setAngle1(e.target.value);
    `;
    const actions = [{ name: "submit" }, { name: "handleAngle1Change" }];
    expect(findUnregisteredActions(code, actions)).toEqual(["submit", "handleAngle1Change"]);
  });

  it("flags only the specific action(s) missing a call, not ones that are correctly registered", () => {
    const code = `bridge.registerAction('reset', () => {});`;
    const actions = [{ name: "reset" }, { name: "unregistered_one" }];
    expect(findUnregisteredActions(code, actions)).toEqual(["unregistered_one"]);
  });
});

describe("escapeRawControlCharsInStrings", () => {
  it("leaves already-valid JSON untouched", () => {
    const json = `{"a":"line one\\nline two","b":1}`;
    expect(escapeRawControlCharsInStrings(json)).toBe(json);
  });

  // Regression test: this is the exact failure found in production — "could not parse the
  // response" on an otherwise well-formed activity. The model emitted a literal raw newline
  // instead of \n at a JS template-literal interpolation boundary inside the `code` field's
  // string value, which is invalid JSON (raw control characters aren't allowed inside a
  // string) even though the rest of that same string was correctly escaped throughout.
  it("escapes a raw newline found inside a JSON string value", () => {
    const broken = '{"code":"line one\nline two"}';
    const repaired = escapeRawControlCharsInStrings(broken);
    expect(() => JSON.parse(repaired)).not.toThrow();
    expect(JSON.parse(repaired).code).toBe("line one\nline two");
  });

  it("does not touch whitespace OUTSIDE string values (valid, pretty-printed JSON)", () => {
    const prettyJson = '{\n  "a": "x",\n  "b": "y"\n}';
    expect(() => JSON.parse(escapeRawControlCharsInStrings(prettyJson))).not.toThrow();
  });

  it("escapes raw tabs and carriage returns the same way as newlines", () => {
    const broken = '{"code":"a\tb\rc"}';
    const repaired = escapeRawControlCharsInStrings(broken);
    const parsed = JSON.parse(repaired);
    expect(parsed.code).toBe("a\tb\rc");
  });

  it("does not break an already-escaped backslash immediately before a quote", () => {
    // A trailing backslash right before the closing quote (e.g. a Windows-style path or regex)
    // must not be misread as escaping that closing quote.
    const json = String.raw`{"a":"ends with backslash\\"}`;
    expect(escapeRawControlCharsInStrings(json)).toBe(json);
    expect(() => JSON.parse(escapeRawControlCharsInStrings(json))).not.toThrow();
  });
});
