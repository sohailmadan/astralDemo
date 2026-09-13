import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { NavProgressBar } from "@/components/generate/nav-progress-bar";

/**
 * Shared header across all three Learn-page states (generating/failed/ready) — a direct-URL
 * hit (refresh, shared link) with no prior navigation history has no reliable way back to the
 * Generate page otherwise.
 */
export function LearnHeader({ title }: { title?: string | null }) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-border pb-4">
      <Link
        href="/"
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <NavProgressBar />
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to activities
      </Link>
      {title && <p className="truncate text-sm font-medium text-foreground">{title}</p>}
    </header>
  );
}
