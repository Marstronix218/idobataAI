import { z } from "zod";
import { assertDatabase, authed, noContent, ok, withApi } from "@/lib/server/http";

type Context = { params: Promise<{ userId: string }> };

export async function PUT(request: Request, { params }: Context) {
  return withApi(async () => {
    const userId = z.uuid().parse((await params).userId);
    const { supabase } = await authed(request);
    // Against a private profile this files a request rather than a follow, so
    // the caller is told which of the two happened instead of a bare boolean.
    const state = assertDatabase(await supabase.rpc("set_user_follow", {
      p_followed_id: userId,
      p_following: true,
    }));
    return ok({ state, following: state === "following" });
  });
}

export async function DELETE(request: Request, { params }: Context) {
  return withApi(async () => {
    const userId = z.uuid().parse((await params).userId);
    const { supabase } = await authed(request);
    // One call covers both unfollowing and withdrawing a pending request.
    assertDatabase(await supabase.rpc("set_user_follow", {
      p_followed_id: userId,
      p_following: false,
    }));
    return noContent();
  });
}
