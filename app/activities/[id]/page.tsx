import { notFound } from "next/navigation";

import { ActivityFrame } from "@/components/activity/activity-frame";
import { ActivityErrorBoundary } from "@/components/activity/error-boundary";
import { GeneratingView } from "@/components/activity/generating-view";
import { getActivity } from "@/lib/supabase/queries";

// Always render per-request — status can change between requests, never a candidate for the
// static/cached path Next's Cache Components mode defaults to.
export const instant = false;

/**
 * Fetches the row directly (server-side) rather than relying on Realtime for initial state —
 * Realtime only pushes changes after a client subscribes, it has no memory of what happened
 * before. Handles all three statuses, since this route is reachable directly (refresh, back
 * button, shared link), not only via a `ready` row's link on the Generate page.
 */
export default async function LearnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const activity = await getActivity(id);

  if (!activity) notFound();

  if (activity.status === "generating") {
    return (
      <main className="mx-auto min-h-screen w-full max-w-2xl px-5 py-16">
        <GeneratingView activityId={activity.id} attempt={activity.generation_attempt} />
      </main>
    );
  }

  if (activity.status === "failed") {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center gap-3 px-5 py-16 text-center">
        <p className="text-sm font-medium text-foreground">This activity couldn&rsquo;t be generated.</p>
        {activity.error && <p className="text-xs text-muted-foreground">{activity.error}</p>}
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-5 py-8 lg:flex-row">
      <div className="min-w-0 flex-1">
        <ActivityErrorBoundary>
          <ActivityFrame activity={activity} />
        </ActivityErrorBoundary>
      </div>
      <aside className="flex w-full flex-col lg:w-80 lg:shrink-0">
        <div className="flex min-h-64 flex-1 items-center justify-center rounded-lg border border-border bg-card p-6 text-center">
          <p className="text-xs text-muted-foreground">Tutor chat lands in Milestone 3.</p>
        </div>
      </aside>
    </main>
  );
}
