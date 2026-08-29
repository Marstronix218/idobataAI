import { ApiError, assertDatabase, authed, ok, withApi } from "@/lib/server/http";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import type { DirectoryPersona, DirectoryUser } from "@/types";

const MAX_QUERY_LENGTH = 50;
// Each side is capped well below the RPC's own ceiling: this feeds a dropdown
// over the feed, not a directory page, and a reader scrolling 50 rows in it has
// already lost the thread.
const PER_KIND_LIMIT = 10;

export async function GET(request: Request) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const query = new URL(request.url).searchParams.get("query")?.trim() ?? "";
    if (query.length > MAX_QUERY_LENGTH) {
      throw new ApiError(400, `Search must be ${MAX_QUERY_LENGTH} characters or fewer.`, "invalid_query");
    }

    // Directory search is the one endpoint that walks every public profile, so
    // it is the cheapest way to enumerate the user base. The definer functions
    // already cap the page size; this caps how often a session can ask.
    await enforceRateLimit(user.id, "directory:search", 120, 3600);

    // Both halves run through definer functions so private accounts and retired
    // personas are never enumerated, the projections are fixed server-side, and
    // LIKE metacharacters in the query are escaped rather than pattern-matched.
    const [peopleResult, personaResult] = await Promise.all([
      supabase.rpc("search_user_directory", { p_query: query, p_limit: PER_KIND_LIMIT }),
      supabase.rpc("search_companion_directory", { p_query: query, p_limit: PER_KIND_LIMIT }),
    ]);

    return ok({
      people: assertDatabase(peopleResult) as DirectoryUser[],
      personas: assertDatabase(personaResult) as DirectoryPersona[],
    });
  });
}
