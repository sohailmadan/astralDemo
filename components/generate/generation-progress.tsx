import { MAX_GENERATION_ATTEMPTS, MAX_TOTAL_MINUTES } from "@/lib/generation-constants";

/**
 * Real progress for a `generating` activity — which attempt is in flight is an exact fact from
 * the DB, shown as-is. No live per-second timer and no "usually done in Xs" claim: actual
 * generation time is genuinely variable (measured anywhere from under a minute to several
 * minutes per attempt in production testing — see CLAUDE.md "Reliability"), so a ticking
 * counter next to a specific-sounding estimate reads as broken the moment reality exceeds it.
 * A static worst-case bound, derived from the pipeline's own retry/timeout constants rather
 * than picked arbitrarily, is the honest thing to show instead.
 */
export function GenerationProgress({ attempt }: { attempt: number }) {
  const isRepair = attempt > 1;

  return (
    <p className="text-xs text-muted-foreground">
      {isRepair
        ? `Fixing an issue — attempt ${attempt} of ${MAX_GENERATION_ATTEMPTS}`
        : "Generating"}
      {" · "}
      can take up to {MAX_TOTAL_MINUTES} minutes
    </p>
  );
}
