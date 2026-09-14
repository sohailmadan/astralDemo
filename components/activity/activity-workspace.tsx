"use client";

import { useCallback, useRef, useState } from "react";

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
  // Bumping this remounts ActivityFrame (via its `key` below) — a full iframe reload, which
  // re-executes the activity's bundled JS from scratch and genuinely resets every useState to
  // its initial value. Chosen over calling a "reset"-shaped registered action because there's
  // no guaranteed name for one across activities (reset, new_problem, reset_problem all appear
  // in practice) — a remount works identically for every activity, no naming assumption needed.
  const [frameKey, setFrameKey] = useState(0);
  // Tracked separately from `activity` (a prop, never refetched after mount): ActivityFrame now
  // seeds the generated code's `initialState` from this on every mount (see sdk/types.ts) so a
  // learner resumes where they left off — but that means a remount after "Reset progress" would
  // reinject the STALE last_state still sitting in `activity.last_state` and silently undo the
  // reset, unless this is explicitly cleared to null first.
  const [lastState, setLastState] = useState(activity.last_state);

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

  const handleResetProgress = useCallback(async () => {
    const res = await fetch(`/api/activities/${activity.id}/events`, { method: "DELETE" });
    if (res.ok) {
      setLastState(null);
      setFrameKey((k) => k + 1);
    }
    return res.ok;
  }, [activity.id]);

  return (
    <>
      <div className="min-w-0 flex-1">
        <ActivityErrorBoundary>
          <ActivityFrame
            key={frameKey}
            ref={frameRef}
            activity={{ ...activity, last_state: lastState }}
            onEvent={handleActivityEvent}
          />
        </ActivityErrorBoundary>
      </div>
      {/*
        Bounded height is required, not cosmetic: TutorChat's own message list relies on
        overflow-y-auto to scroll internally, but that never engages on a container that's free
        to grow to fit its content — it would just keep growing and the whole page would scroll
        past it instead. h-[70vh] gives it a real height on every breakpoint; lg:sticky keeps it
        pinned in view alongside the activity iframe (which can be taller, e.g. up to 900px) on
        desktop, matching main's py-8 (2rem top + bottom = 4rem) so it fills the exact remaining
        viewport height without an extra scrollbar of its own.
      */}
      <aside className="flex h-[70vh] min-h-0 w-full flex-col lg:sticky lg:top-8 lg:h-[calc(100vh-4rem)] lg:w-80 lg:shrink-0">
        <TutorChat
          ref={tutorRef}
          activityId={activity.id}
          initialMessages={initialMessages}
          onActionCall={handleAction}
          onResetProgress={handleResetProgress}
        />
      </aside>
    </>
  );
}
