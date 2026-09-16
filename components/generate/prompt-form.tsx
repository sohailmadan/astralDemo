"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { generateActivity } from "@/lib/api-client";
import { EXAMPLE_PROMPTS } from "@/lib/example-prompts";
import { MAX_PROMPT_LENGTH } from "@/lib/generation-constants";

/**
 * The Generate page's input. Submitting POSTs to /api/generate, which inserts the row and
 * returns immediately — the new row then appears in ActivityList via the Realtime
 * subscription there, not by us pushing it into local state here. One source of truth.
 *
 * Deliberately does NOT call router.refresh() after submitting — found directly in production:
 * doing so raced with ActivityList's own Realtime subscription (under this app's Cache
 * Components mode, a refresh right after the insert could tear down and recreate the
 * subscription at the exact moment the just-inserted row's event was in flight, missing it —
 * Realtime doesn't redeliver a past event to a freshly re-established subscription). Since
 * ActivityList is Realtime-driven end to end, nothing here needs the server-refreshed props.
 */
export function PromptForm() {
  const [prompt, setPrompt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = prompt.trim();
  const canSubmit = trimmed.length > 0 && !isSubmitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await generateActivity(trimmed);
      setPrompt("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value.slice(0, MAX_PROMPT_LENGTH))}
        placeholder="Describe what you want to learn — e.g. “Teach me about y-intercept and slope.”"
        maxLength={MAX_PROMPT_LENGTH}
        rows={3}
        className="resize-none text-base"
        disabled={isSubmitting}
      />

      <div className="flex flex-wrap gap-2">
        {EXAMPLE_PROMPTS.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setPrompt(example)}
            disabled={isSubmitting}
            className="rounded-full border border-border bg-secondary px-3 py-1 text-xs text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {example}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          {trimmed.length}/{MAX_PROMPT_LENGTH}
        </p>
        <Button type="submit" disabled={!canSubmit} className="sm:w-auto">
          {isSubmitting ? "Starting…" : "Generate"}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
