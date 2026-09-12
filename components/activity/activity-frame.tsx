import type { Activity } from "@/lib/types";

/**
 * Placeholder for Milestone 1 — owns nothing sandboxed yet. Milestone 2 replaces the body of
 * this component with the compiled-bundle-in-a-sandboxed-iframe + postMessage bridge described
 * in CLAUDE.md ("Safely execute" / "AI tutor <-> activity interface"), while keeping the same
 * props contract so the Learn page doesn't need to change.
 */
export function ActivityFrame({ activity }: { activity: Activity }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card p-10 text-center">
      <p className="text-sm font-medium text-foreground">{activity.title}</p>
      <p className="text-xs text-muted-foreground">
        Generated activity rendering lands in Milestone 2.
      </p>
    </div>
  );
}
