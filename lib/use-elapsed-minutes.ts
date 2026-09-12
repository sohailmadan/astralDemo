"use client";

import { useEffect, useState } from "react";

/**
 * Whole minutes elapsed since `since` (an ISO timestamp) — deliberately coarse (checked every
 * 15s, displayed in whole minutes), not a per-second ticker. A per-second counter next to a
 * "could take minutes" estimate reads as false precision; whole minutes is honest about how
 * approximate this actually is.
 */
export function useElapsedMinutes(since: string): number {
  const [minutes, setMinutes] = useState(() => computeMinutes(since));

  useEffect(() => {
    setMinutes(computeMinutes(since));
    const id = setInterval(() => setMinutes(computeMinutes(since)), 15_000);
    return () => clearInterval(id);
  }, [since]);

  return minutes;
}

function computeMinutes(since: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 60_000));
}
