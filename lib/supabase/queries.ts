import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { Activity } from "@/lib/types";

/** Initial paint for the Generate page's list — Realtime takes over from here client-side. */
export async function listActivities(): Promise<Activity[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("activities")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data as Activity[];
}

/**
 * Server-only lookup by id, used for the Learn page's initial fetch (see CLAUDE.md — the
 * direct-URL edge case means this can't rely on Realtime alone, which has no memory of state
 * before a client subscribes). Uses the service-role client since this needs to work
 * regardless of the anon SELECT policy's shape.
 */
export async function getActivity(id: string): Promise<Activity | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("activities").select("*").eq("id", id).single();

  if (error) {
    if (error.code === "PGRST116") return null; // no row found
    throw error;
  }
  return data as Activity;
}
