import Link from "next/link";

import { NavProgressBar } from "@/components/generate/nav-progress-bar";
import { APP_NAME } from "@/lib/app-copy";

/**
 * Persistent top bar shared by both pages (rendered once in app/layout.tsx, not duplicated per
 * page) — what makes this read as one product with two views rather than two unrelated pages.
 * The Generate and Learn pages each keep their own secondary, page-specific header below this
 * for page-local navigation/context (e.g. Learn's "back to activities" + activity title).
 */
export function AppHeader() {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-5 py-3.5">
        <Link href="/" className="flex items-center gap-2">
          <NavProgressBar />
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
          >
            {APP_NAME.charAt(0)}
          </span>
          <span className="text-sm font-semibold tracking-tight text-foreground">{APP_NAME}</span>
        </Link>
      </div>
    </header>
  );
}
