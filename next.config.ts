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
  //
  // tailwindcss/postcss (used by lib/validate/compile.ts's Tailwind step) need the same
  // treatment for a related but distinct reason, found via a real production-build failure:
  // Tailwind locates its own bundled preflight.css internally via `__dirname`, which Next's
  // server bundler rewrites to a virtual path when it bundles the package — breaking that
  // lookup with ENOENT at runtime under `next start`, even though the exact same code path
  // worked fine calling compileActivity() directly outside Next's bundler (e.g. from a plain
  // script, or under `next dev`'s more lenient bundling). Excluding both from bundling lets
  // them load via real require() with their own real __dirname.
  serverExternalPackages: ["esbuild", "tailwindcss", "postcss"],
  // Found via a real deployment failure: esbuild (lib/validate/compile.ts) resolves
  // "react"/"react-dom" for the GENERATED activity's own bundle at runtime, via nodePaths
  // pointing at this function's own node_modules — but that resolution happens inside a
  // template string, not a static import, so Next's file-tracing (which decides what each
  // serverless function's bundle actually contains) has no way to see it's needed and prunes
  // it. Worked locally (a full node_modules on disk) and failed only once actually deployed
  // ("Could not resolve react/jsx-runtime", "react-dom/client") — force-include them.
  outputFileTracingIncludes: {
    "/api/generate": [
      "./node_modules/react/**/*",
      "./node_modules/react-dom/**/*",
      // react-dom's own runtime dependency — surfaced by a second real deployment failure
      // after adding react/react-dom alone wasn't enough ("Could not resolve scheduler").
      "./node_modules/scheduler/**/*",
    ],
  },
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
