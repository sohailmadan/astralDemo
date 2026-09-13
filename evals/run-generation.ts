#!/usr/bin/env bun
/**
 * Executable eval provider for promptfoo (see evals/generation.eval.yaml). Called once per
 * test case with the learning-request prompt as argv[2]. Runs the real generation + compile
 * pipeline (the exact same lib/ai/generateActivity.ts + lib/validate/compile.ts used by
 * /api/generate, not a reimplementation) and prints one JSON line to stdout for promptfoo's
 * assertions to inspect.
 *
 * Run via `bun run evals/run-generation.ts "<prompt>"` — promptfoo's `exec:` provider type
 * shells out to a command per test case, which sidesteps needing promptfoo's own JS/TS
 * provider-loading machinery to understand this project's modules.
 */
import { generateActivityCode } from "../lib/ai/generateActivity";
import { compileActivity } from "../lib/validate/compile";

const prompt = process.argv[2];
if (!prompt) {
  console.error("Usage: run-generation.ts <prompt>");
  process.exit(1);
}

const generation = await generateActivityCode(prompt);
const compiled = await compileActivity(generation.code);

console.log(
  JSON.stringify({
    title: generation.title,
    code: generation.code,
    actions: generation.actions,
    compiled: compiled.ok,
    compileErrors: compiled.ok ? null : compiled.errors,
  }),
);
