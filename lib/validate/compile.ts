import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as esbuild from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

/**
 * Validate step of the pipeline (see CLAUDE.md "Generation: fixed contract"). esbuild
 * transforms/bundles syntax — it never executes the input, so running this server-side on
 * LLM-generated code carries none of the risk `eval()` on untrusted code would. The only
 * point this code ever actually *runs* is later, client-side, inside the sandboxed iframe.
 *
 * Approach: write the generated TSX plus the two SDK files to a temp directory alongside a
 * small bootstrap entry file, then let esbuild bundle from real files on disk — simpler and
 * more reliable than an in-memory virtual-module esbuild plugin for this scope.
 *
 * Also compiles a matching Tailwind stylesheet, scoped to only the classes the generated code
 * actually uses. This is necessary, not cosmetic: the sandboxed iframe is a wholly separate
 * document with no access to our compiled app stylesheet or our `:root` CSS variables, so
 * without this every Tailwind className in generated code would render completely unstyled.
 * The generation prompt is told to use plain Tailwind palette classes (e.g. `bg-sky-500`), not
 * our semantic aliases (`bg-primary`) — those resolve to `hsl(var(--primary))`, and that
 * variable only exists in our own app's document, not the iframe's.
 */

export interface CompileError {
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export type CompileResult =
  | { ok: true; code: string; css: string }
  | { ok: false; errors: CompileError[] };

const SDK_DIR = path.join(process.cwd(), "sdk");
const PROJECT_NODE_MODULES = path.join(process.cwd(), "node_modules");

const ENTRY_SOURCE = `import { createRoot } from "react-dom/client";
import Activity from "./Activity";

const container = document.getElementById("root");
if (!container) throw new Error("root element missing");
createRoot(container).render(<Activity />);

// Reports real content height to the host so it can size the iframe to fit (see
// components/activity/activity-frame.tsx) instead of a fixed height that wastes space on a
// short activity or clips/scrolls a tall one. Not part of the useTutorBridge() SDK contract —
// this is host-rendering plumbing the generated code never needs to know about.
let lastReportedHeight = 0;
function reportHeight() {
  const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
  if (height !== lastReportedHeight) {
    lastReportedHeight = height;
    window.parent.postMessage({ type: "RESIZE", height }, "*");
  }
}
new ResizeObserver(reportHeight).observe(document.documentElement);
reportHeight();
`;

export async function compileActivity(generatedTsx: string): Promise<CompileResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "astral-activity-"));

  try {
    const [sdkSource, typesSource] = await Promise.all([
      readFile(path.join(SDK_DIR, "activity-sdk.ts"), "utf8"),
      readFile(path.join(SDK_DIR, "types.ts"), "utf8"),
    ]);

    await Promise.all([
      writeFile(path.join(dir, "Activity.tsx"), generatedTsx, "utf8"),
      writeFile(path.join(dir, "entry.tsx"), ENTRY_SOURCE, "utf8"),
      writeFile(path.join(dir, "activity-sdk.ts"), sdkSource, "utf8"),
      writeFile(path.join(dir, "types.ts"), typesSource, "utf8"),
    ]);

    const result = await esbuild.build({
      entryPoints: [path.join(dir, "entry.tsx")],
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: "es2020",
      jsx: "automatic",
      jsxImportSource: "react",
      nodePaths: [PROJECT_NODE_MODULES],
      logLevel: "silent",
      minify: true,
      define: { "process.env.NODE_ENV": '"production"' },
    });

    const output = result.outputFiles?.[0]?.text;
    if (!output) {
      return { ok: false, errors: [{ message: "esbuild produced no output" }] };
    }

    const css = await compileTailwind(generatedTsx);
    return { ok: true, code: output, css };
  } catch (err) {
    return { ok: false, errors: extractEsbuildErrors(err) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// JIT-compiles Tailwind directly against the generated source string — Tailwind's `raw`
// content entry means no temp file is needed for this half of the pipeline. Deliberately a
// bare Tailwind config (default palette + preflight base reset only, no theme.extend) since
// our own tailwind.config.ts's semantic tokens depend on CSS variables the iframe doesn't have.
async function compileTailwind(generatedTsx: string): Promise<string> {
  const result = await postcss([
    tailwindcss({
      content: [{ raw: generatedTsx, extension: "tsx" }],
      corePlugins: { preflight: true },
    }),
  ]).process("@tailwind base; @tailwind utilities;", { from: undefined });
  return result.css;
}

// Reduce to just the basename — the repair prompt only needs to know it was "Activity.tsx"
// (the file the model actually wrote), not our internal filesystem layout. (Not path.relative
// against the temp dir: macOS resolves /tmp through a /private/tmp symlink, which esbuild's
// reported path follows and our own `dir` variable doesn't, so a relative computation between
// them produces a long, wrong "../../.." chain instead of a clean relative path.)
function extractEsbuildErrors(err: unknown): CompileError[] {
  if (err && typeof err === "object" && "errors" in err) {
    const failure = err as esbuild.BuildFailure;
    return failure.errors.map((e) => ({
      message: e.text,
      file: e.location?.file ? path.basename(e.location.file) : undefined,
      line: e.location?.line,
      column: e.location?.column,
    }));
  }
  return [{ message: err instanceof Error ? err.message : String(err) }];
}
