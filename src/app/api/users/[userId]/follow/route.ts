import { z } from "zod";
import { assertDatabase, authed, noContent, ok, withApi } from "@/lib/server/http";

type Context = { params: Promise<{ userId: string }> };

export async function PUT(request: Request, { params }: Context) {
  return withApi(async () => {
    const userId = z.uuid().parse((await params).userId);
    const { supabase } = await authed(request);
    const following = assertDatabase(await supabase.rpc("set_user_follow", {
      p_followed_id: userId,
      p_following: true,
    }));
    return ok({ following });
  });
}

export async function DELETE(request: Request, { params }: Context) {
  return withApi(async () => {
    const userId = z.uuid().parse((await params).userId);
    const { supabase } = await authed(request);
    assertDatabase(await supabase.rpc("set_user_follow", {
      p_followed_id: userId,
      p_following: false,
    }));
    return noContent();
  });
}
