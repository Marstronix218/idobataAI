import { z } from "zod";
import { requireApiGate } from "@/lib/flags/route-gates";
import { assertDatabase, authed, noContent, withApi } from "@/lib/server/http";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Context) {
  return withApi(async () => {
    await requireApiGate("social_feed");
    const { user, supabase } = await authed(request);
    const id = z.uuid().parse((await params).id);
    assertDatabase(await supabase.from("social_replies").delete().eq("id", id).eq("author_id", user.id).select("id").maybeSingle());
    return noContent();
  });
}

