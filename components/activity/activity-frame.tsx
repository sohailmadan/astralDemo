"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { buildActivityIframeHtml } from "@/lib/validate/iframe-html";
import type { Activity } from "@/lib/types";
import type { ActivityToHostMessage } from "@/sdk/types";

const READY_TIMEOUT_MS = 5000;
const ACTION_TIMEOUT_MS = 5000;

// Bounds for the auto-sizing iframe (see the RESIZE message below). MIN keeps a short activity
// from collapsing to an awkward sliver before its first real measurement arrives; MAX is a
// deliberate ceiling so a runaway/buggy activity can't stretch the whole page — content taller
// than that scrolls inside the iframe instead (the browser's default iframe overflow), which
// is an honest degraded state, not a silent failure.
const MIN_IFRAME_HEIGHT = 300;
const MAX_IFRAME_HEIGHT = 900;

export interface ActivityFrameHandle {
  /** Forwards a tutor-invoked action into the iframe and resolves with its ACTION_RESULT. */
  sendAction(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; error?: string }>;
}

/**
 * Renders the compiled activity inside a sandboxed iframe. See CLAUDE.md "Safely execute" —
 * `sandbox="allow-scripts"` only (deliberately no `allow-same-origin`) is what isolates this
 * from the host's cookies/storage/DOM; the iframe's own CSP (baked into the srcDoc, see
 * lib/validate/iframe-html.ts) is what blocks any network access from inside it.
 *
 * Forwards ref so the tutor chat (which lives in a sibling component, not inside this one) can
 * invoke `sendAction` without either side reaching into the other's internals — the imperative
 * handle is the entire coupling surface between them.
 */
export const ActivityFrame = forwardRef<ActivityFrameHandle, { activity: Activity }>(
  function ActivityFrame({ activity }, ref) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "hung">("loading");
    const [height, setHeight] = useState(MIN_IFRAME_HEIGHT);
    const pendingActionRef = useRef<{
      name: string;
      resolve: (result: { ok: boolean; error?: string }) => void;
    } | null>(null);

    const srcDoc =
      activity.compiled_js && activity.compiled_css !== null
        ? buildActivityIframeHtml(activity.compiled_js, activity.compiled_css ?? "")
        : null;

    useImperativeHandle(ref, () => ({
      sendAction(name, args) {
        return new Promise((resolve) => {
          pendingActionRef.current = { name, resolve };
          iframeRef.current?.contentWindow?.postMessage({ type: "ACTION_CALL", name, args }, "*");
          setTimeout(() => {
            if (pendingActionRef.current?.name === name) {
              pendingActionRef.current = null;
              resolve({ ok: false, error: "Action timed out." });
            }
          }, ACTION_TIMEOUT_MS);
        });
      },
    }));

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

        if (data.type === "RESIZE") {
          setHeight(Math.min(MAX_IFRAME_HEIGHT, Math.max(MIN_IFRAME_HEIGHT, data.height)));
        }

        // Persistence and the live bridge are the same event, not two separate features (see
        // CLAUDE.md "AI tutor <-> activity interface") — every publishState/emitEvent call the
        // activity makes is durably stored, not just held here in memory.
        if (data.type === "STATE_SNAPSHOT") {
          void fetch(`/api/activities/${activity.id}/events`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "state", state: data.state }),
          });
        }

        if (data.type === "EVENT") {
          void fetch(`/api/activities/${activity.id}/events`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "event", eventType: data.eventType, payload: data.payload }),
          });
        }

        if (data.type === "ACTION_RESULT" && pendingActionRef.current?.name === data.name) {
          pendingActionRef.current.resolve({ ok: data.ok, error: data.error });
          pendingActionRef.current = null;
        }
      }

      window.addEventListener("message", handleMessage);
      return () => {
        window.removeEventListener("message", handleMessage);
        clearTimeout(timeout);
      };
    }, [srcDoc, activity.id]);

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
          className="w-full bg-white transition-[height] duration-150"
          style={{ height }}
        />
      </div>
    );
  },
);
