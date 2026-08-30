import { z } from "zod";
import { assertDatabase, authed, noContent, ok, parseJson, withApi } from "@/lib/server/http";

const relationshipUpdateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("follow"), following: z.boolean() }).strict(),
  z.object({ action: z.literal("favorite"), favorite: z.boolean() }).strict(),
  z.object({ action: z.literal("respond"), accept: z.boolean() }).strict(),
  z.object({ action: z.literal("dm-opt-in"), enabled: z.boolean() }).strict(),
]);

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return withApi(async () => {
    const companionId = z.uuid().parse((await params).id);
    const { user, supabase } = await authed(request);
    const relationship = assertDatabase(await supabase
      .from("user_companion_relationships")
      .select("*")
      .eq("user_id", user.id)
      .eq("companion_id", companionId)
      .maybeSingle());
    return ok({ relationship });
  });
}

export async function PUT(request: Request, { params }: Context) {
  return withApi(async () => {
    const companionId = z.uuid().parse((await params).id);
    const { supabase } = await authed(request);
    const input = await parseJson(request, relationshipUpdateSchema);

    if (input.action === "follow") {
      const relationship = assertDatabase(await supabase.rpc("set_user_companion_follow", {
        p_companion_id: companionId,
        p_following: input.following,
      }));
      return ok({ relationship });
    }

    if (input.action === "favorite") {
      const relationship = assertDatabase(await supabase.rpc("set_user_companion_favorite", {
        p_companion_id: companionId,
        p_favorite: input.favorite,
      }));
      return ok({ relationship });
    }

    if (input.action === "respond") {
      const relationship = assertDatabase(await supabase.rpc("respond_companion_follow", {
        p_companion_id: companionId,
        p_accept: input.accept,
      }));
      return ok({ relationship });
    }

    const relationship = assertDatabase(await supabase.rpc("set_companion_dm_opt_in", {
      p_companion_id: companionId,
      p_opt_in: input.enabled,
    }));
    return ok({ relationship });
  });
}

export async function DELETE(request: Request, { params }: Context) {
  return withApi(async () => {
    const companionId = z.uuid().parse((await params).id);
    const { supabase } = await authed(request);
    assertDatabase(await supabase.rpc("set_user_companion_follow", {
      p_companion_id: companionId,
      p_following: false,
    }));
    return noContent();
  });
}
