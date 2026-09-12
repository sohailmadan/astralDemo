import { describe, expect, it } from "bun:test";

import { buildActivityIframeHtml } from "./iframe-html";

describe("buildActivityIframeHtml", () => {
  it("embeds the compiled JS and CSS inline, with no external resource references", () => {
    const html = buildActivityIframeHtml("console.log('hi')", ".foo { color: red }");

    expect(html).toContain("console.log('hi')");
    expect(html).toContain(".foo { color: red }");
    expect(html).not.toMatch(/src=["']https?:/);
    expect(html).not.toMatch(/href=["']https?:/);
  });

  it("sets a restrictive CSP with no network access allowed", () => {
    const html = buildActivityIframeHtml("", "");

    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain("connect-src");
    expect(html).not.toContain("fetch");
  });

  // Regression test: a `#root { min-height: 100vh }` rule here would feed back on itself once
  // the entry script's ResizeObserver reports height to the host (see compile.ts's
  // ENTRY_SOURCE and activity-frame.tsx) — it would always measure "100% of the iframe's
  // current height," never the content's real size, so the iframe could never shrink to fit.
  it("does not constrain #root's height, so the auto-sizing ResizeObserver can measure real content", () => {
    const html = buildActivityIframeHtml("", "");

    expect(html).not.toMatch(/#root\s*\{[^}]*min-height/);
  });
});
