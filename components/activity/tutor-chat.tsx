"use client";

import { useState } from "react";

import type { TutorActionCall, TutorMessage } from "@/lib/types";

type ChatMessage = Pick<TutorMessage, "role" | "content"> & {
  id: string;
  actionNote?: string;
};

function toChatMessage(m: TutorMessage): ChatMessage {
  return { id: m.id, role: m.role, content: m.content };
}

export function TutorChat({
  activityId,
  initialMessages,
  onActionCall,
}: {
  activityId: string;
  initialMessages: TutorMessage[];
  onActionCall: (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => initialMessages.map(toChatMessage));
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isSending) return;

    setInput("");
    setIsSending(true);
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: "user", content: text }]);

    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityId, message: text }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: body?.error ?? "Something went wrong. Try again.",
          },
        ]);
        return;
      }

      const data: { content: string; actionCall?: TutorActionCall } = await res.json();
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
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `error-${Date.now()}`, role: "assistant", content: "Couldn't reach the tutor. Try again." },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-medium text-foreground">Tutor</h2>

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
}
