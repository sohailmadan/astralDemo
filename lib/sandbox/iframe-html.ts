/**
 * Builds the sandboxed iframe's `srcdoc`. See CLAUDE.md "Safely execute" for the security
 * posture this encodes: `sandbox="allow-scripts"` only (no `allow-same-origin`, set on the
 * <iframe> element itself, not here) gives this document an opaque origin with no access to
 * the parent's cookies/storage/DOM; this CSP additionally blocks any network access from
 * inside it (no fetch/XHR/WebSocket, no external script/style/image sources) — that's what
 * actually prevents a data-exfiltration attempt from generated code, not just what blocks
 * imports at compile time.
 */
export function buildActivityIframeHtml(js: string, css: string): string {
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
  html, body { margin: 0; padding: 0; }
  #root { min-height: 100vh; }
</style>
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>`;
}
