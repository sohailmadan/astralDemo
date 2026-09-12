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
});
