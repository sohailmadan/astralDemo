import { useEffect, useRef } from "react";

import type { ActivityToHostMessage, HostToActivityMessage, TutorBridge } from "./types";

function postToHost(message: ActivityToHostMessage) {
  // The sandboxed iframe (sandbox="allow-scripts", no allow-same-origin) has an opaque
  // origin, so it can't target the host by a specific origin string — "*" is the standard,
  // correct choice here. The host verifies the message actually came from *this* iframe by
  // checking `event.source`, not by trusting an origin (see ActivityFrame).
  window.parent.postMessage(message, "*");
}

/**
 * The one hook every generated activity uses to talk to the tutor. Bundled directly into the
 * generated code by esbuild (see lib/validate/compile.ts) — this file has no dependency on our
 * Next.js app at runtime, it only needs React, which is bundled alongside it.
 */
export function useTutorBridge(): TutorBridge {
  const actionsRef = useRef(new Map<string, (args: Record<string, unknown>) => void>());

  useEffect(() => {
    function handleMessage(event: MessageEvent<HostToActivityMessage>) {
      const data = event.data;
      if (!data || data.type !== "ACTION_CALL") return;

      const handler = actionsRef.current.get(data.name);
      if (!handler) {
        postToHost({ type: "ACTION_RESULT", name: data.name, ok: false, error: "Unknown action" });
        return;
      }
      try {
        handler(data.args ?? {});
        postToHost({ type: "ACTION_RESULT", name: data.name, ok: true });
      } catch (err) {
        postToHost({
          type: "ACTION_RESULT",
          name: data.name,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    window.addEventListener("message", handleMessage);
    postToHost({ type: "READY" });
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return {
    publishState(state) {
      postToHost({ type: "STATE_SNAPSHOT", state });
    },
    emitEvent(type, payload) {
      postToHost({ type: "EVENT", eventType: type, payload });
    },
    registerAction(name, handler) {
      actionsRef.current.set(name, handler);
    },
  };
}
