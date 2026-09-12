import { cn } from "@/lib/utils";
import type { ActivityStatus } from "@/lib/types";

const STYLES: Record<ActivityStatus, string> = {
  generating: "bg-secondary text-secondary-foreground",
  ready: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
};

const LABELS: Record<ActivityStatus, string> = {
  generating: "Generating",
  ready: "Ready",
  failed: "Failed",
};

export function StatusBadge({ status }: { status: ActivityStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        STYLES[status],
      )}
    >
      {status === "generating" && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      )}
      {LABELS[status]}
    </span>
  );
}
