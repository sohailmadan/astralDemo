"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { generateActivity } from "@/lib/api-client";

/**
 * Shown once a `generating` row exceeds MAX_TOTAL_MINUTES (see lib/use-is-stale.ts) — the
 * pipeline's own real ceiling, so exceeding it is a genuine signal something died outside its
 * error handling, not a "please wait a bit more" nudge. Offers a real way out: start a fresh
 * attempt rather than leave the learner staring at a promise that's already been broken.
 */
export function StalledNotice({ prompt }: { prompt: string }) {
  const [isRetrying, setIsRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRetry() {
    setIsRetrying(true);
    setError(null);
    try {
      await generateActivity(prompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a new attempt.");
      setIsRetrying(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <p className="text-xs text-amber-700">
        This is taking longer than expected — it may have stalled.
      </p>
      <Button type="button" size="sm" variant="outline" onClick={handleRetry} disabled={isRetrying}>
        {isRetrying ? "Starting a new attempt…" : "Try again"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
