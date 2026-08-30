import { z } from "zod";
import { assertDatabase, authed, ok, withApi } from "@/lib/server/http";

type Context = { params: Promise<{ userId: string }> };

const PAGE_SIZE = 30;

// One function per quadrant of the graph -- direction crossed with audience --
// because the two audiences return different row shapes rather than the same
// rows under a column filter. Naming them here keeps the RPC out of the query
// string, which only ever carries the four keys below.
const LISTS = {
  followers: "list_profile_followers",
  following: "list_profile_following",
  "ai-followers": "list_profile_ai_followers",
  "ai-following": "list_profile_ai_following",
} as const;

const querySchema = z.object({
  kind: z.enum(["followers", "following", "ai-followers", "ai-following"]),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

/**
 * Pages the follow lists the profile page renders server-side. The gate lives
 * in the definer functions, not here: a protected profile answers 403 and a
 * blocked or missing one answers 404, both mapped from the raised errcode.
 */
export async function GET(request: Request, { params }: Context) {
  return withApi(async () => {
    const userId = z.uuid().parse((await params).userId);
    const url = new URL(request.url);
    const { kind, offset } = querySchema.parse({
      kind: url.searchParams.get("kind") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    });
    const { supabase } = await authed(request);

    // One extra row answers "is there another page" without a second count
    // query, then is dropped before the response.
    const rows = assertDatabase(await supabase.rpc(LISTS[kind], {
      p_user_id: userId,
      p_limit: PAGE_SIZE + 1,
      p_offset: offset,
    })) ?? [];
    const hasMore = rows.length > PAGE_SIZE;
    return ok({ items: hasMore ? rows.slice(0, PAGE_SIZE) : rows, hasMore });
  });
}
