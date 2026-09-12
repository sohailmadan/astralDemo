"use client";

import { useEffect, useState } from "react";

import { MAX_TOTAL_MINUTES } from "@/lib/generation-constants";

/**
 * True once a `generating` row has been running longer than the pipeline's own worst-case
 * ceiling (MAX_TOTAL_MINUTES, derived from its actual retry/timeout constants — see
 * generation-constants.ts). Every code path inside the pipeline resolves to `ready` or
 * `failed` within that budget, so exceeding it means something died outside the pipeline's own
 * error handling (a crashed/killed process — see CLAUDE.md "after() is not a durable queue"),
 * not that generation is merely slow. Re-checked periodically since staleness is a function of
 * elapsed time, not something a DB write will ever announce on its own.
 */
export function useIsStale(createdAt: string, status: string): boolean {
  const [isStale, setIsStale] = useState(() => computeStale(createdAt, status));

  useEffect(() => {
    if (status !== "generating") {
      setIsStale(false);
      return;
    }
    setIsStale(computeStale(createdAt, status));
    const id = setInterval(() => setIsStale(computeStale(createdAt, status)), 15_000);
    return () => clearInterval(id);
  }, [createdAt, status]);

  return isStale;
}

function computeStale(createdAt: string, status: string): boolean {
  if (status !== "generating") return false;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  return ageMs > MAX_TOTAL_MINUTES * 60_000;
}
