import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — bypasses Row Level Security entirely.
 *
 * Only ever import this from server-side code (route handlers, `after()` callbacks).
 * Never import it from a Client Component or anything that ships to the browser —
 * the anon-key clients in `client.ts` / `server.ts` are what the browser is allowed to use.
 *
 * See CLAUDE.md "Security" for why this split exists: with no auth in this app, RLS is the
 * only thing standing between the public internet and the database, so it matters which key
 * does which job.
 */
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
