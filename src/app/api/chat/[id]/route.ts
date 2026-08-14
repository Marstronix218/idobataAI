import { z } from "zod";
import { assertDatabase, authed, ok, withApi } from "@/lib/server/http";
import type { ChatMessage, ChatPeer, ChatThread, SocialCompanion, UserProfile } from "@/types";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const id = z.uuid().parse((await params).id);
    const thread = assertDatabase(await supabase.from("chat_threads").select("*").eq("id", id).single(), true) as ChatThread;
    const messages = assertDatabase(await supabase.from("chat_messages")
      .select("*")
      .eq("thread_id", id)
      .eq("content_status", "active")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(100)) as ChatMessage[];

    let peer: ChatPeer;
    if (thread.companion_id) {
      const companion = assertDatabase(await supabase.from("social_companions")
        .select("id, slug, name, avatar_url, personality")
        .eq("id", thread.companion_id)
        .single(), true) as Pick<SocialCompanion, "id" | "slug" | "name" | "avatar_url" | "personality">;
      peer = {
        id: companion.id,
        kind: "companion",
        name: companion.name,
        handle: companion.slug,
        avatarUrl: companion.avatar_url,
        description: companion.personality,
      };
    } else {
      const peerId = thread.user_one_id === user.id ? thread.user_two_id : thread.user_one_id;
      const profile = assertDatabase(await supabase.from("user_profiles")
        .select("id, username, display_name, avatar_url, bio")
        .eq("id", peerId!)
        .single(), true) as Pick<UserProfile, "id" | "username" | "display_name" | "avatar_url" | "bio">;
      peer = {
        id: profile.id,
        kind: "user",
        name: profile.display_name?.trim() || profile.username,
        handle: profile.username,
        avatarUrl: profile.avatar_url,
        description: profile.bio,
      };
    }

    return ok({ thread, peer, messages: messages.reverse() });
  });
}
