"use client";

import { forwardRef, useImperativeHandle, useState } from "react";

import { clearTutorMessages, sendTutorMessage } from "@/lib/api-client";
import type { TutorMessage } from "@/lib/types";

type ChatMessage = Pick<TutorMessage, "role" | "content"> & {
  id: string;
  actionNote?: string;
};

function toChatMessage(m: TutorMessage): ChatMessage {
  return { id: m.id, role: m.role, content: m.content };
}

export interface TutorChatHandle {
  /** Sends a message to the tutor exactly as if the learner had typed it — used both by the
   * composer below and by activity-workspace.tsx to auto-forward events like
   * "hint_requested" into a real tutor turn, so the chat transcript reads naturally either way. */
  sendMessage(text: string): Promise<void>;
}

export const TutorChat = forwardRef<
  TutorChatHandle,
  {
    activityId: string;
    initialMessages: TutorMessage[];
    onActionCall: (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
    /** Clears activity_events/last_state AND remounts the activity iframe so it visibly reverts
     * to its initial screen — the actual reset+remount coordination lives in
     * activity-workspace.tsx, which is the only place that holds a ref to the iframe. */
    onResetProgress: () => Promise<boolean>;
  }
>(function TutorChat({ activityId, initialMessages, onActionCall, onResetProgress }, ref) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => initialMessages.map(toChatMessage));
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  async function handleClear() {
    setIsClearing(true);
    try {
      if (await clearTutorMessages(activityId)) {
        setMessages([]);
      }
    } finally {
      setIsClearing(false);
    }
  }

  // Distinct from "Clear chat": this resets the activity itself back to its initial screen AND
  // clears what the tutor knows about progress (activity_events + last_state) — not the
  // conversation, which "Clear chat" handles separately. The actual reset+remount happens in
  // activity-workspace.tsx (onResetProgress), since only it holds a ref to the iframe.
  async function handleResetProgress() {
    if (!confirm("Reset this activity back to its starting screen? The tutor will also forget your progress on it. This won't clear the chat conversation.")) {
      return;
    }
    setIsResetting(true);
    try {
      await onResetProgress();
    } finally {
      setIsResetting(false);
    }
  }

  async function sendMessage(text: string) {
    if (!text.trim() || isSending) return;

    setIsSending(true);
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: "user", content: text }]);

    try {
      const data = await sendTutorMessage(activityId, text);
      let actionNote: string | undefined;

      if (data.actionCall) {
        const result = await onActionCall(data.actionCall.name, data.actionCall.args);
        actionNote = result.ok
          ? `✓ ${data.actionCall.name}`
          : `Couldn't perform ${data.actionCall.name}: ${result.error ?? "unknown error"}`;
      }

      setMessages((prev) => [
        ...prev,
        { id: `reply-${Date.now()}`, role: "assistant", content: data.content, actionNote },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: err instanceof Error ? err.message : "Couldn't reach the tutor. Try again.",
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  useImperativeHandle(ref, () => ({ sendMessage }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    await sendMessage(text);
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">Tutor</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={handleResetProgress}
            disabled={isResetting}
            title="Resets the activity to its starting screen and clears what the tutor knows about your progress."
            className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
          >
            Reset progress
          </button>
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              disabled={isClearing}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
            >
              Clear chat
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Ask a question, or ask the tutor to do something in the activity.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
              m.role === "user"
                ? "ml-auto bg-primary text-primary-foreground"
                : "bg-accent text-accent-foreground"
            }`}
          >
            <p>{m.content}</p>
            {m.actionNote && <p className="mt-1 text-xs opacity-80">{m.actionNote}</p>}
          </div>
        ))}
        {isSending && <p className="text-xs text-muted-foreground">Thinking…</p>}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the tutor..."
          disabled={isSending}
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          disabled={isSending || !input.trim()}
          className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
});
