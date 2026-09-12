"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { GenerationProgress } from "@/components/generate/generation-progress";
import { NavProgressBar } from "@/components/generate/nav-progress-bar";
import { StalledNotice } from "@/components/generate/stalled-notice";
import { StatusBadge } from "@/components/generate/status-badge";
import { createClient } from "@/lib/supabase/client";
import type { Activity } from "@/lib/types";
import { useIsStale } from "@/lib/use-is-stale";

/**
 * Realtime-subscribed activity list. Subscribes to BOTH insert and update events on
 * `activities` — insert is what makes a just-submitted row appear immediately in `generating`
 * status with no refresh; update is what flips it to ready/failed live. See CLAUDE.md
 * "Persistence & no-manual-refresh requirement" for why both matter, not just one.
 */
export function ActivityList({ initialActivities }: { initialActivities: Activity[] }) {
  const [activitiesById, setActivitiesById] = useState<Map<string, Activity>>(
    () => new Map(initialActivities.map((a) => [a.id, a])),
  );

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("activities-feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "activities" },
        (payload) => {
          const row = payload.new as Activity | undefined;
          if (!row?.id) return;
          setActivitiesById((prev) => {
            const next = new Map(prev);
            next.set(row.id, row);
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const activities = useMemo(
    () =>
      Array.from(activitiesById.values()).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [activitiesById],
  );

  if (activities.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No activities yet — describe what you want to learn above to generate your first one.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {activities.map((activity) => (
        <ActivityRow key={activity.id} activity={activity} />
      ))}
    </ul>
  );
}

function ActivityRow({ activity }: { activity: Activity }) {
  const title = activity.title ?? activity.prompt;
  const isStale = useIsStale(activity.created_at, activity.status);

  const content = (
    <div className="flex items-center justify-between gap-4 p-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{title}</p>
        {activity.status === "failed" && activity.error && (
          <p className="mt-0.5 truncate text-xs text-destructive">{activity.error}</p>
        )}
        {activity.status === "generating" &&
          (isStale ? (
            <StalledNotice prompt={activity.prompt} />
          ) : (
            <GenerationProgress createdAt={activity.created_at} attempt={activity.generation_attempt} />
          ))}
      </div>
      <StatusBadge status={activity.status} />
    </div>
  );

  const baseClasses = "rounded-lg border border-border bg-card transition-colors";

  if (activity.status === "ready") {
    return (
      <li>
        <Link
          href={`/activities/${activity.id}`}
          className={`${baseClasses} block hover:border-primary/40 hover:bg-accent/40`}
        >
          <NavProgressBar />
          {content}
        </Link>
      </li>
    );
  }

  return (
    <li className={`${baseClasses} ${activity.status === "generating" ? "opacity-80" : ""}`}>
      {content}
    </li>
  );
}
