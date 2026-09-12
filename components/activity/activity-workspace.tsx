"use client";

import { useRef } from "react";

import { ActivityFrame, type ActivityFrameHandle } from "@/components/activity/activity-frame";
import { ActivityErrorBoundary } from "@/components/activity/error-boundary";
import { TutorChat } from "@/components/activity/tutor-chat";
import type { Activity, TutorMessage } from "@/lib/types";

/**
 * Client-side pairing of the activity iframe and the tutor chat — the Learn page itself is a
 * server component, so this is where the two sides actually meet: TutorChat needs to invoke
 * actions on the iframe ActivityFrame owns, and ActivityFrame's imperative handle (see
 * activity-frame.tsx) is the entire coupling surface between them.
 */
export function ActivityWorkspace({
  activity,
  initialMessages,
}: {
  activity: Activity;
  initialMessages: TutorMessage[];
}) {
  const frameRef = useRef<ActivityFrameHandle>(null);

  return (
    <>
      <div className="min-w-0 flex-1">
        <ActivityErrorBoundary>
          <ActivityFrame ref={frameRef} activity={activity} />
        </ActivityErrorBoundary>
      </div>
      <aside className="flex min-h-0 w-full flex-col lg:w-80 lg:shrink-0">
        <TutorChat
          activityId={activity.id}
          initialMessages={initialMessages}
          onActionCall={(name, args) => {
            if (!frameRef.current) return Promise.resolve({ ok: false, error: "Activity not ready." });
            return frameRef.current.sendAction(name, args);
          }}
        />
      </aside>
    </>
  );
}
