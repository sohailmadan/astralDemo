/**
 * Shared between the pipeline (app/api/generate/route.ts) and the UI's progress display, so
 * "attempt X of N" / the time estimate shown to the user can never drift out of sync with the
 * actual retry limit and per-call timeout.
 */
export const MAX_REPAIR_ATTEMPTS = 2;
export const MAX_GENERATION_ATTEMPTS = MAX_REPAIR_ATTEMPTS + 1; // + the initial attempt

// Matches generateActivity.ts's abortSignal timeout (in seconds). Used only to derive an
// honest worst-case total below — never shown to the user directly as a per-attempt promise,
// since real per-attempt latency varies too much for that to read as anything but wrong.
const TYPICAL_ATTEMPT_SECONDS = 120;

// Worst case if every attempt runs the full timeout, rounded up — a static bound derived from
// the pipeline's real constants, not a number picked to sound reassuring.
export const MAX_TOTAL_MINUTES = Math.ceil(
  (MAX_GENERATION_ATTEMPTS * TYPICAL_ATTEMPT_SECONDS) / 60,
);
