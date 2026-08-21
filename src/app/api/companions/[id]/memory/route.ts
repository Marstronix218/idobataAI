import { z } from "zod";
import { assertDatabase, authed, noContent, ok, withApi } from "@/lib/server/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return withApi(async () => {
    const companionId = z.uuid().parse((await params).id);
    const { user, supabase } = await authed(request);
    const memory = assertDatabase(await supabase
      .from("companion_user_memory")
      .select("*")
      .eq("user_id", user.id)
      .eq("companion_id", companionId)
      .maybeSingle());
    return ok({ memory });
  });
}

export async function DELETE(request: Request, { params }: Context) {
  return withApi(async () => {
    const companionId = z.uuid().parse((await params).id);
    const { supabase } = await authed(request);
    assertDatabase(await supabase.rpc("reset_companion_memory", { p_companion_id: companionId }));
    return noContent();
  });
}
