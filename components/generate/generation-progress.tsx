"use client";

import { MAX_GENERATION_ATTEMPTS, MAX_TOTAL_MINUTES } from "@/lib/generation-constants";
import { useElapsedMinutes } from "@/lib/use-elapsed-minutes";

/**
 * Real progress for a `generating` activity — which attempt is in flight is an exact fact from
 * the DB, shown as-is. Time remaining is a coarse (whole-minute) countdown from
 * MAX_TOTAL_MINUTES, the pipeline's own real worst-case ceiling — not a live per-second timer
 * (false precision) and not a fixed estimate that stays wrong once real elapsed time has
 * passed it (see CLAUDE.md "Reliability" — actual generation time is genuinely variable).
 * Once elapsed time reaches the ceiling, `useIsStale`/`StalledNotice` take over instead of
 * this component continuing to promise a shrinking number.
 */
export function GenerationProgress({ createdAt, attempt }: { createdAt: string; attempt: number }) {
  const isRepair = attempt > 1;
  const elapsedMinutes = useElapsedMinutes(createdAt);
  const remainingMinutes = Math.max(1, MAX_TOTAL_MINUTES - elapsedMinutes);

  const timeNote =
    elapsedMinutes < 1
      ? `can take up to ${MAX_TOTAL_MINUTES} minutes`
      : `may take up to ${remainingMinutes} more minute${remainingMinutes === 1 ? "" : "s"}`;

  return (
    <p className="text-xs text-muted-foreground">
      {isRepair
        ? `Fixing an issue — attempt ${attempt} of ${MAX_GENERATION_ATTEMPTS}`
        : "Generating"}
      {" · "}
      {timeNote}
    </p>
  );
}
