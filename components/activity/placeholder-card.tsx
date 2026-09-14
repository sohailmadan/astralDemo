/**
 * The centered "nothing to show yet" card shape reused across every non-interactive activity
 * state: loading, hung, no-compiled-output, the host-side error boundary, and (at the larger
 * size) the generating view. Previously four near-identical copies of the same className
 * string had drifted slightly out of sync (p-6 vs p-10, flex vs flex-col+gap) with no
 * functional reason for the difference.
 */
export function PlaceholderCard({
  children,
  size = "sm",
}: {
  children: React.ReactNode;
  size?: "sm" | "lg";
}) {
  return (
    <div
      className={`flex min-h-64 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card text-center ${
        size === "lg" ? "gap-3 p-10" : "p-6"
      }`}
    >
      {children}
    </div>
  );
}
