"use client";

import { useLinkStatus } from "next/link";

/**
 * Must render as a child of <Link> — useLinkStatus reads pending state from the nearest
 * ancestor Link, it can't be called in the same component that renders the Link itself.
 * Gives the YouTube-style top progress bar while the Learn page's server fetch is in flight,
 * instead of a click that appears to do nothing until the new page is ready.
 */
export function NavProgressBar() {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-primary/20">
      <div className="h-full w-1/3 animate-[nav-progress_1s_ease-in-out_infinite] bg-primary" />
    </div>
  );
}
