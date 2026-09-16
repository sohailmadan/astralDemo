const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every id in this app (activities.id) is a Postgres-generated uuid — reject anything else
 * before it ever reaches a Supabase query, rather than letting an arbitrary string round-trip
 * to Postgres just to come back "not found." Basic shape validation on every route that takes
 * an id from the URL or request body. */
export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Strips control characters (other than \n and \t) that a real prompt or chat message has no
 * reason to contain — null bytes, escape sequences, etc. React already escapes everything it
 * renders and no route ever concatenates user text into a raw SQL/HTML string, so this isn't
 * closing an XSS hole; it's keeping the text that reaches the database and the LLM prompt
 * actually clean, so nothing unprintable can slip through unnoticed. */
export function stripControlChars(value: string): string {
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}
