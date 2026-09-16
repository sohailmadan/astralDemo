"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { PlaceholderCard } from "@/components/activity/placeholder-card";
import { generateActivity } from "@/lib/api-client";

/**
 * The learner-facing dead end for a `failed` activity. Two things this fixes over just showing
 * `activity.error` directly: (1) that string is whatever the last repair attempt's real error
 * was — compiler/bundler internals like "Could not resolve 'scheduler'" — genuinely useful for
 * debugging, meaningless and unpolished-looking to a learner, so it's tucked behind an optional
 * disclosure instead of being the headline; (2) there was previously no way forward from this
 * page at all, just the error and nowhere to go — "Try again" starts a fresh attempt (same
 * pattern as StalledNotice) and navigates to it, rather than leaving the learner stuck on a
 * page that already failed.
 */
export function FailedView({ prompt, error }: { prompt: string; error: string | null }) {
  const router = useRouter();
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  async function handleRetry() {
    setIsRetrying(true);
    setRetryError(null);
    try {
      const { id } = await generateActivity(prompt);
      router.push(`/activities/${id}`);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Could not start a new attempt.");
      setIsRetrying(false);
    }
  }

  return (
    <PlaceholderCard size="lg">
      <p className="text-sm font-medium text-foreground">This activity couldn&rsquo;t be generated.</p>
      <Button type="button" size="sm" onClick={handleRetry} disabled={isRetrying}>
        {isRetrying ? "Starting a new attempt…" : "Try again"}
      </Button>
      {retryError && <p className="text-xs text-destructive">{retryError}</p>}
      {error && (
        <details className="mt-1 text-left text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Technical details</summary>
          <p className="mt-1 break-words">{error}</p>
        </details>
      )}
    </PlaceholderCard>
  );
}
