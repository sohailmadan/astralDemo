/**
 * Builds the sandboxed iframe's `srcdoc`. See CLAUDE.md "Safely execute" for the security
 * posture this encodes: `sandbox="allow-scripts"` only (no `allow-same-origin`, set on the
 * <iframe> element itself, not here) gives this document an opaque origin with no access to
 * the parent's cookies/storage/DOM; this CSP additionally blocks any network access from
 * inside it (no fetch/XHR/WebSocket, no external script/style/image sources) — that's what
 * actually prevents a data-exfiltration attempt from generated code, not just what blocks
 * imports at compile time.
 */
export function buildActivityIframeHtml(
  js: string,
  css: string,
  initialState: Record<string, unknown> | null = null,
): string {
  // Escaping "</" (not just "</script") is deliberate: it's the only sequence the HTML parser
  // treats as a potential close tag inside a <script> block, wherever it appears in the JSON
  // (e.g. a string value containing "</div>"), and JSON.stringify gives no control over that.
  const initialStateJson = JSON.stringify(initialState).replace(/<\//g, "<\\/");
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data:",
    "font-src data:",
  ].join("; ");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  /* No min-height on #root: the entry script measures real content height and reports it to
     the host (see compile.ts's ENTRY_SOURCE) so the host can size the iframe to fit. A
     vh-based min-height here would feed back on itself — it would always report "full height
     of whatever the iframe currently is," never the content's actual size. */
  html, body { margin: 0; padding: 0; }
</style>
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>window.__ASTRAL_INITIAL_STATE__ = ${initialStateJson};</script>
<script>${js}</script>
</body>
</html>`;
}
