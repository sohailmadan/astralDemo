import { notFound } from "next/navigation";

import { ActivityWorkspace } from "@/components/activity/activity-workspace";
import { GeneratingView } from "@/components/activity/generating-view";
import { LearnHeader } from "@/components/activity/learn-header";
import { getActivity, listTutorMessages } from "@/lib/supabase/queries";

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
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-5 py-8">
        <LearnHeader />
        <GeneratingView
          activityId={activity.id}
          prompt={activity.prompt}
          createdAt={activity.created_at}
          attempt={activity.generation_attempt}
        />
      </main>
    );
  }

  if (activity.status === "failed") {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-5 py-8">
        <LearnHeader />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm font-medium text-foreground">This activity couldn&rsquo;t be generated.</p>
          {activity.error && <p className="text-xs text-muted-foreground">{activity.error}</p>}
        </div>
      </main>
    );
  }

  const tutorMessages = await listTutorMessages(activity.id);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-5 py-8">
      <LearnHeader title={activity.title} />
      <div className="flex flex-1 flex-col gap-6 lg:flex-row">
        <ActivityWorkspace activity={activity} initialMessages={tutorMessages} />
      </div>
    </main>
  );
}
