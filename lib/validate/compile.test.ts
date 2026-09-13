import { describe, expect, it } from "bun:test";

import { compileActivity, validateRequiredImports } from "./compile";

const VALID_ACTIVITY = `
  import { useState } from "react";
  import { useTutorBridge } from "./activity-sdk";

  export default function Activity() {
    const [count, setCount] = useState(0);
    const bridge = useTutorBridge();

    function increment() {
      const next = count + 1;
      setCount(next);
      bridge.publishState({ count: next });
      bridge.emitEvent("count_changed", { count: next });
    }

    return (
      <div className="flex flex-col gap-2 bg-sky-50 p-4">
        <p className="text-slate-900">Count: {count}</p>
        <button className="rounded bg-sky-500 px-3 py-1 text-white" onClick={increment}>
          Add one
        </button>
      </div>
    );
  }
`;

describe("compileActivity", () => {
  it("compiles a valid activity that uses the SDK contract", async () => {
    const result = await compileActivity(VALID_ACTIVITY);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.code.length).toBeGreaterThan(0);
      // Bundled + minified React should be well under 300KB — a regression here (e.g. losing
      // the minify/production define) would silently balloon every generated activity's payload.
      expect(result.code.length).toBeLessThan(300_000);
    }
  });

  it("compiles a scoped Tailwind stylesheet containing only the classes actually used", async () => {
    const result = await compileActivity(VALID_ACTIVITY);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.css).toContain(".bg-sky-500");
      expect(result.css).toContain(".text-slate-900");
      // A class never referenced in the source shouldn't appear in the scoped output.
      expect(result.css).not.toContain(".bg-emerald-700");
    }
  });

  it("reports a structured error for invalid syntax, without leaking the temp file path", async () => {
    const result = await compileActivity(`
      import { useState } from "react";
      import { useTutorBridge } from "./activity-sdk";

      export default function Activity() {
        return <div>{unclosed
      }
    `);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].file).toBe("Activity.tsx");
      expect(result.errors[0].line).toBeGreaterThan(0);
    }
  });

  it("reports an error for code that doesn't satisfy the SDK contract (unknown import)", async () => {
    const result = await compileActivity(`
      import { useState } from "react";
      import leftpad from "left-pad";

      export default function Activity() {
        return <div>{leftpad("x", 5)}</div>;
      }
    `);

    expect(result.ok).toBe(false);
  });

  // Regression test: found directly in production — a generated activity used
  // useState/useEffect/useTutorBridge throughout with NO import statement for either "react"
  // or "./activity-sdk" anywhere in the file. esbuild bundles this "successfully" (a bare,
  // undeclared identifier isn't a module-resolution failure or a syntax error), and it only
  // throws ReferenceError once the browser actually executes it — the activity renders as
  // nothing at all, with no visible error. This must be caught here, before esbuild ever runs.
  it("fails fast when the required react/activity-sdk imports are missing entirely", async () => {
    const result = await compileActivity(`
      export default function Activity() {
        const bridge = useTutorBridge();
        const [count, setCount] = useState(0);
        return <div>{count}</div>;
      }
    `);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes("react"))).toBe(true);
      expect(result.errors.some((e) => e.message.includes("activity-sdk"))).toBe(true);
    }
  });
});

describe("validateRequiredImports", () => {
  it("returns no errors when both required imports are present", () => {
    const code = `
      import { useState } from "react";
      import { useTutorBridge } from "./activity-sdk";
    `;
    expect(validateRequiredImports(code)).toEqual([]);
  });

  it("reports only the react import as missing when activity-sdk is present", () => {
    const code = `import { useTutorBridge } from "./activity-sdk";`;
    const errors = validateRequiredImports(code);
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("react");
  });

  it("reports both as missing when neither import is present", () => {
    const errors = validateRequiredImports(`export default function Activity() { return null; }`);
    expect(errors.length).toBe(2);
  });
});
