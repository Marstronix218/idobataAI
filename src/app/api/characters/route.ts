import { requireAgeVerified } from "@/lib/coach/age";
import { listSelectableCharacters } from "@/lib/coach/characters";
import { requireApiGate } from "@/lib/flags/route-gates";
import { authed, ok, withApi } from "@/lib/server/http";

/** The characters the caller may choose: launch characters and owned packs. */
export async function GET(request: Request) {
  return withApi(async () => {
    await requireApiGate("pivot_a");
    const { user, supabase } = await authed(request);
    await requireAgeVerified(supabase, user.id);
    return ok({ items: await listSelectableCharacters(supabase, user.id) });
  });
}
