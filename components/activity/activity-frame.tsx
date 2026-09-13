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
interface ActivityFrameProps {
  activity: Activity;
  /**
   * Fired for every EVENT the activity emits, in addition to the persistence POST below —
   * this is the hook the tutor chat uses to react to specific events (see
   * activity-workspace.tsx: "hint_requested" auto-forwards into a tutor turn). Without this,
   * emitEvent("hint_requested", ...) only ever reached the durable log, never the tutor —
   * a "Need a hint?" button that looked wired but did nothing visible.
   */
  onEvent?: (eventType: string, payload: unknown) => void;
}

export const ActivityFrame = forwardRef<ActivityFrameHandle, ActivityFrameProps>(
  function ActivityFrame({ activity, onEvent }, ref) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "hung">("loading");
    const [height, setHeight] = useState(MIN_IFRAME_HEIGHT);
    const pendingActionRef = useRef<{
      name: string;
      resolve: (result: { ok: boolean; error?: string }) => void;
    } | null>(null);

    // Found directly via a real, reproducible bug: this page is server-rendered (not
    // statically prerendered, but SSR'd on every request), which bakes the iframe's `srcDoc`
    // straight into the initial HTML. The browser starts executing that iframe's content the
    // instant it parses that HTML — BEFORE React's own JS bundle has loaded or hydrated. When
    // hydration then runs and (re)creates this iframe element client-side, the ORIGINAL
    // server-parsed instance's execution context is torn down mid-flight — after its
    // synchronous top-level code (the entry script's immediate ResizeObserver + first
    // reportHeight() call) had already fired a RESIZE message, but BEFORE its React effects
    // (which run asynchronously, including useTutorBridge()'s own effect that posts READY) got
    // a chance to complete. Confirmed directly: RESIZE reliably arrived, READY never did, on an
    // activity whose exact same compiled bundle sent both correctly in an isolated non-SSR'd
    // iframe test. Gating the iframe behind a mounted-only render means it is NEVER part of
    // SSR output at all — created exactly once, client-side, after hydration has already
    // settled, with nothing to interrupt its single execution.
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

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
      if (!mounted || !srcDoc) return;

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
          onEvent?.(data.eventType, data.payload);
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
    }, [mounted, srcDoc, activity.id, onEvent]);

    if (!srcDoc) {
      return (
        <div className="flex min-h-64 items-center justify-center rounded-lg border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">This activity has no compiled output.</p>
        </div>
      );
    }

    // Only `mounted` gates this — NOT `status`. The iframe must actually be present and
    // executing while status is still "loading" in order to ever send READY at all; hiding it
    // until status flips away from "loading" would make that flip impossible (a real bug
    // caught while fixing this).
    if (!mounted) {
      return (
        <div className="flex min-h-64 items-center justify-center rounded-lg border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">Loading activity…</p>
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
