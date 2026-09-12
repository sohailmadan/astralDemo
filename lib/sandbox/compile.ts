import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as esbuild from "esbuild";

/**
 * Validate step of the pipeline (see CLAUDE.md "Generation: fixed contract"). esbuild
 * transforms/bundles syntax — it never executes the input, so running this server-side on
 * LLM-generated code carries none of the risk `eval()` on untrusted code would. The only
 * point this code ever actually *runs* is later, client-side, inside the sandboxed iframe.
 *
 * Approach: write the generated TSX plus the two SDK files to a temp directory alongside a
 * small bootstrap entry file, then let esbuild bundle from real files on disk — simpler and
 * more reliable than an in-memory virtual-module esbuild plugin for this scope.
 */

export interface CompileError {
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export type CompileResult =
  | { ok: true; code: string }
  | { ok: false; errors: CompileError[] };

const SDK_DIR = path.join(process.cwd(), "sdk");
const PROJECT_NODE_MODULES = path.join(process.cwd(), "node_modules");

const ENTRY_SOURCE = `import { createRoot } from "react-dom/client";
import Activity from "./Activity";

const container = document.getElementById("root");
if (!container) throw new Error("root element missing");
createRoot(container).render(<Activity />);
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
    return { ok: true, code: output };
  } catch (err) {
    return { ok: false, errors: extractEsbuildErrors(err) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
