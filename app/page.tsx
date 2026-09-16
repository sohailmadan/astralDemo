import { ActivityList } from "@/components/generate/activity-list";
import { PromptForm } from "@/components/generate/prompt-form";
import { APP_TAGLINE } from "@/lib/app-copy";
import { listActivities } from "@/lib/supabase/queries";

// Always render per-request — this list is per-user live data, never a candidate for the
// static/cached path Next's Cache Components mode defaults to.
export const instant = false;

export default async function GeneratePage() {
  const activities = await listActivities();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-5 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          What do you want to learn?
        </h1>
        <p className="text-sm text-muted-foreground">{APP_TAGLINE}</p>
      </header>

      <div className="flex flex-1 flex-col gap-8 lg:flex-row">
        <div className="lg:w-96 lg:shrink-0">
          <PromptForm />
        </div>

        <section className="flex min-h-0 flex-1 flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Your activities
          </h2>
          <div className="max-h-[70vh] overflow-y-auto rounded-lg lg:max-h-none">
            <ActivityList initialActivities={activities} />
          </div>
        </section>
      </div>
    </main>
  );
}
