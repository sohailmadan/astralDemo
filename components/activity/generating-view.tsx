"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { GenerationProgress } from "@/components/generate/generation-progress";
import { StalledNotice } from "@/components/generate/stalled-notice";
import { createClient } from "@/lib/supabase/client";
import { useIsStale } from "@/lib/use-is-stale";

/**
 * Shown when the Learn page is opened (direct URL, refresh, back button — not only via the
 * Generate page's list) for an activity still `status: generating`. Subscribes to Realtime for
 * this one row so it flips over live once generation finishes, with no manual refresh — the
 * same guarantee the Generate page's list has, extended to this edge case. See CLAUDE.md
 * "Render" step 7's direct-URL note.
 *
 * `router.refresh()` on every update (not just the final ready/failed one) is what also keeps
 * the attempt-number progress display current as the pipeline moves through repair attempts,
 * not only when it finishes.
 */
export function GeneratingView({
  activityId,
  prompt,
  createdAt,
  attempt,
}: {
  activityId: string;
  prompt: string;
  createdAt: string;
  attempt: number;
}) {
  const isStale = useIsStale(createdAt, "generating");
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`activity-${activityId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "activities",
          filter: `id=eq.${activityId}`,
        },
        () => router.refresh(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activityId, router]);

  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card p-10 text-center">
      <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
      <p className="text-sm text-muted-foreground">
        Generating your activity — this page will update automatically.
      </p>
      {isStale ? <StalledNotice prompt={prompt} /> : <GenerationProgress attempt={attempt} />}
    </div>
  );
}
