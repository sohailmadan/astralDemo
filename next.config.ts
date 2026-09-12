import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Multiple lockfiles up the directory tree (unrelated projects under ~/Sites) confuse
  // Next's workspace-root inference — pin it explicitly to this project.
  turbopack: {
    root: path.join(__dirname),
  },
  // esbuild ships a native binary package (@esbuild/darwin-arm64 etc.) with non-JS files
  // (README.md) that Turbopack chokes on trying to bundle for the server. It's server-only,
  // Node-native code anyway — tell Next to require() it directly at runtime instead of
  // bundling it, which is what this option exists for.
  serverExternalPackages: ["esbuild"],
  // Baseline security headers on the host app itself — separate from, and in addition to, the
  // sandboxed activity iframe's own CSP (see CLAUDE.md "Security considerations"). Cheap to
  // add, easy to forget.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
