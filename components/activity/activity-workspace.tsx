"use client";

import { useCallback, useRef } from "react";

import { ActivityFrame, type ActivityFrameHandle } from "@/components/activity/activity-frame";
import { ActivityErrorBoundary } from "@/components/activity/error-boundary";
import { TutorChat, type TutorChatHandle } from "@/components/activity/tutor-chat";
import type { Activity, TutorMessage } from "@/lib/types";

/**
 * Client-side pairing of the activity iframe and the tutor chat — the Learn page itself is a
 * server component, so this is where the two sides actually meet: TutorChat needs to invoke
 * actions on the iframe ActivityFrame owns, and ActivityFrame's imperative handle (see
 * activity-frame.tsx) is the entire coupling surface between them.
 *
 * Also where "Need a hint?" actually reaches the tutor: emitEvent("hint_requested", ...) only
 * ever persisted to the events log on its own (see activity-frame.tsx) — nothing consumed it to
 * start a tutor turn, so the button looked wired but did nothing visible. This forwards it into
 * a real tutor message, exactly as if the learner had typed it themselves.
 */
export function ActivityWorkspace({
  activity,
  initialMessages,
}: {
  activity: Activity;
  initialMessages: TutorMessage[];
}) {
  const frameRef = useRef<ActivityFrameHandle>(null);
  const tutorRef = useRef<TutorChatHandle>(null);

  const handleAction = useCallback(
    (name: string, args: Record<string, unknown>) => {
      if (!frameRef.current) return Promise.resolve({ ok: false, error: "Activity not ready." });
      return frameRef.current.sendAction(name, args);
    },
    [],
  );

  const handleActivityEvent = useCallback((eventType: string) => {
    if (eventType === "hint_requested") {
      void tutorRef.current?.sendMessage("I'd like a hint, please.");
    }
  }, []);

  return (
    <>
      <div className="min-w-0 flex-1">
        <ActivityErrorBoundary>
          <ActivityFrame ref={frameRef} activity={activity} onEvent={handleActivityEvent} />
        </ActivityErrorBoundary>
      </div>
      <aside className="flex min-h-0 w-full flex-col lg:w-80 lg:shrink-0">
        <TutorChat
          ref={tutorRef}
          activityId={activity.id}
          initialMessages={initialMessages}
          onActionCall={handleAction}
        />
      </aside>
    </>
  );
}
