"use client";

import { Component, type ReactNode } from "react";

/**
 * Wraps ActivityFrame (the component owning the iframe + postMessage bridge). Catches bugs in
 * *our own* host-side bridge/rendering code — the sandboxed generated code itself can never
 * reach this thread, so this is not a defense against the generated activity, just against us.
 * See CLAUDE.md "Safely execute" / "Error boundary on the host side".
 */
export class ActivityErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("ActivityFrame error boundary caught:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-64 items-center justify-center rounded-lg border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Something went wrong displaying this activity. Try reloading the page.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
