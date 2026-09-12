import { ActivityList } from "@/components/generate/activity-list";
import { PromptForm } from "@/components/generate/prompt-form";
import { listActivities } from "@/lib/supabase/queries";

// Always render per-request — this list is per-user live data, never a candidate for the
// static/cached path Next's Cache Components mode defaults to.
export const instant = false;

export default async function GeneratePage() {
  const activities = await listActivities();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-10 px-5 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Generative Interactive Learning
        </h1>
        <p className="text-sm text-muted-foreground">
          Describe what you want to learn. You&rsquo;ll get a generated,
          interactive activity with an AI tutor.
        </p>
      </header>

      <PromptForm />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Your activities
        </h2>
        <ActivityList initialActivities={activities} />
      </section>
    </main>
  );
}
