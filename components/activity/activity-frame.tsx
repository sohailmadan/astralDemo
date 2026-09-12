"use client";

import { useEffect, useRef, useState } from "react";

import { buildActivityIframeHtml } from "@/lib/sandbox/iframe-html";
import type { Activity } from "@/lib/types";
import type { ActivityToHostMessage } from "@/sdk/types";

const READY_TIMEOUT_MS = 5000;

/**
 * Renders the compiled activity inside a sandboxed iframe. See CLAUDE.md "Safely execute" —
 * `sandbox="allow-scripts"` only (deliberately no `allow-same-origin`) is what isolates this
 * from the host's cookies/storage/DOM; the iframe's own CSP (baked into the srcDoc, see
 * lib/sandbox/iframe-html.ts) is what blocks any network access from inside it.
 *
 * Milestone 2 scope: render + the READY handshake/hang-protection timeout. Milestone 3 adds
 * persisting STATE_SNAPSHOT/EVENT messages to activity_events and the ACTION_CALL bridge for
 * the tutor — built together with the tutor, per CLAUDE.md, since persistence and the live
 * bridge are the same event, not two separate features.
 */
export function ActivityFrame({ activity }: { activity: Activity }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "hung">("loading");

  const srcDoc =
    activity.compiled_js && activity.compiled_css !== null
      ? buildActivityIframeHtml(activity.compiled_js, activity.compiled_css ?? "")
      : null;

  useEffect(() => {
    if (!srcDoc) return;

    const timeout = setTimeout(() => setStatus((s) => (s === "loading" ? "hung" : s)), READY_TIMEOUT_MS);

    function handleMessage(event: MessageEvent<ActivityToHostMessage>) {
      // Verify the message actually came from *this* iframe. The sandboxed frame has an
      // opaque origin (no allow-same-origin), so origin-string matching isn't available here —
      // checking event.source against our own iframe's contentWindow is the correct check.
      if (event.source !== iframeRef.current?.contentWindow) return;

      const data = event.data;
      if (!data?.type) return;

      if (data.type === "READY") {
        clearTimeout(timeout);
        setStatus("ready");
      }
      // STATE_SNAPSHOT / EVENT / ACTION_RESULT handling lands in Milestone 3 with the tutor.
    }

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      clearTimeout(timeout);
    };
  }, [srcDoc]);

  if (!srcDoc) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-lg border border-border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">This activity has no compiled output.</p>
      </div>
    );
  }

  if (status === "hung") {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card p-6 text-center">
        <p className="text-sm font-medium text-foreground">This activity didn&rsquo;t load correctly.</p>
        <p className="text-xs text-muted-foreground">Try regenerating it.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        title={activity.title ?? "Generated activity"}
        className="h-[600px] w-full bg-white"
      />
    </div>
  );
}
