import { z } from "zod";
import { assertDatabase, authed, ok, parseJson, withApi } from "@/lib/server/http";
import type { ChatPeer, ChatThread, ChatThreadSummary, SocialCompanion, UserProfile } from "@/types";

const createThreadSchema = z.object({
  userId: z.uuid().nullable().optional(),
  companionId: z.uuid().nullable().optional(),
}).refine((value) => Number(Boolean(value.userId)) + Number(Boolean(value.companionId)) === 1, {
  message: "Choose exactly one chat recipient.",
});

export async function GET(request: Request) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const threads = assertDatabase(await supabase
      .from("chat_threads")
      .select("*")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(100)) as ChatThread[];

    const userIds = [...new Set(threads.flatMap((thread) => [thread.user_one_id, thread.user_two_id])
      .filter((id): id is string => Boolean(id) && id !== user.id))];
    const companionIds = [...new Set(threads.map((thread) => thread.companion_id)
      .filter((id): id is string => Boolean(id)))];
    const [profileResult, companionResult] = await Promise.all([
      userIds.length
        ? supabase.from("user_profiles").select("id, username, display_name, avatar_url, bio").in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
      companionIds.length
        ? supabase.from("social_companions").select("id, slug, name, avatar_url, personality").in("id", companionIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const profiles = assertDatabase(profileResult) as Array<Pick<UserProfile, "id" | "username" | "display_name" | "avatar_url" | "bio">>;
    const companions = assertDatabase(companionResult) as Array<Pick<SocialCompanion, "id" | "slug" | "name" | "avatar_url" | "personality">>;
    const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
    const companionMap = new Map(companions.map((companion) => [companion.id, companion]));

    const items = threads.flatMap<ChatThreadSummary>((thread) => {
      let peer: ChatPeer | null = null;
      if (thread.companion_id) {
        const companion = companionMap.get(thread.companion_id);
        if (companion) peer = {
          id: companion.id,
          kind: "companion",
          name: companion.name,
          handle: companion.slug,
          avatarUrl: companion.avatar_url,
          description: companion.personality,
        };
      } else {
        const peerId = thread.user_one_id === user.id ? thread.user_two_id : thread.user_one_id;
        const profile = peerId ? profileMap.get(peerId) : null;
        if (profile) peer = {
          id: profile.id,
          kind: "user",
          name: profile.display_name?.trim() || profile.username,
          handle: profile.username,
          avatarUrl: profile.avatar_url,
          description: profile.bio,
        };
      }
      return peer ? [{ thread, peer }] : [];
    });

    return ok({ items });
  });
}

export async function POST(request: Request) {
  return withApi(async () => {
    const { supabase } = await authed(request);
    const input = await parseJson(request, createThreadSchema);
    const thread = assertDatabase(await supabase.rpc("get_or_create_chat_thread", {
      p_user_id: input.userId ?? null,
      p_companion_id: input.companionId ?? null,
    })) as ChatThread;
    return ok(thread, { status: 201 });
  });
}
