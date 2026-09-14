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

  describe("initialState", () => {
    it("defaults to null when omitted, so a fresh activity gets no prior state", () => {
      const html = buildActivityIframeHtml("", "");
      expect(html).toContain("window.__ASTRAL_INITIAL_STATE__ = null;");
    });

    it("embeds the given state as JSON before the compiled bundle runs", () => {
      const html = buildActivityIframeHtml("console.log('bundle')", "", { step: 2, dividend: 452 });
      const stateIndex = html.indexOf("__ASTRAL_INITIAL_STATE__");
      const bundleIndex = html.indexOf("console.log('bundle')");
      expect(stateIndex).toBeGreaterThan(-1);
      expect(stateIndex).toBeLessThan(bundleIndex);
      expect(html).toContain('{"step":2,"dividend":452}');
    });

    // Regression guard: a state value containing a literal "</script>" (e.g. a string the
    // learner typed, later published back via bridge.publishState) would otherwise close the
    // injected script tag early, corrupting the srcDoc's HTML structure — this isn't a
    // theoretical XSS vector (the iframe already has no same-origin access), but it would still
    // break the page by truncating the JSON and running whatever text followed as markup.
    it("escapes a literal </script> inside the state so it can't close the injected tag early", () => {
      const html = buildActivityIframeHtml("", "", { note: "</script><script>evil()" });
      expect(html).not.toContain("</script><script>evil()");
      expect(html).toContain("<\\/script>");
    });
  });
});
