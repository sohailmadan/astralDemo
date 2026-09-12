"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Shown when the Learn page is opened (direct URL, refresh, back button — not only via the
 * Generate page's list) for an activity still `status: generating`. Subscribes to Realtime for
 * this one row so it flips over live once generation finishes, with no manual refresh — the
 * same guarantee the Generate page's list has, extended to this edge case. See CLAUDE.md
 * "Render" step 7's direct-URL note.
 */
export function GeneratingView({ activityId }: { activityId: string }) {
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
    </div>
  );
}
