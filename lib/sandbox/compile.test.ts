import { describe, expect, it } from "bun:test";

import { compileActivity } from "./compile";

describe("compileActivity", () => {
  it("compiles a valid activity that uses the SDK contract", async () => {
    const result = await compileActivity(`
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
          <div>
            <p>Count: {count}</p>
            <button onClick={increment}>Add one</button>
          </div>
        );
      }
    `);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.code.length).toBeGreaterThan(0);
      // Bundled + minified React should be well under 300KB — a regression here (e.g. losing
      // the minify/production define) would silently balloon every generated activity's payload.
      expect(result.code.length).toBeLessThan(300_000);
    }
  });

  it("reports a structured error for invalid syntax, without leaking the temp file path", async () => {
    const result = await compileActivity(`
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
});
