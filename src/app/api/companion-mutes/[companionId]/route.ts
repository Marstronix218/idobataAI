import { z } from "zod";
import { assertDatabase, authed, noContent, ok, withApi } from "@/lib/server/http";

type Context = { params: Promise<{ companionId: string }> };

export async function PUT(request: Request, { params }: Context) {
  return withApi(async () => {
    const companionId = z.uuid().parse((await params).companionId);
    const { supabase } = await authed(request);
    const result = await supabase.rpc("set_companion_mute", { p_companion_id: companionId, p_muted: true });
    return ok({ changed: assertDatabase(result) });
  });
}

export async function DELETE(request: Request, { params }: Context) {
  return withApi(async () => {
    const companionId = z.uuid().parse((await params).companionId);
    const { supabase } = await authed(request);
    assertDatabase(await supabase.rpc("set_companion_mute", { p_companion_id: companionId, p_muted: false }));
    return noContent();
  });
}
