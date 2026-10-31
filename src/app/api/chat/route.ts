import { z } from "zod";
import { requireApiGate } from "@/lib/flags/route-gates";
import { assertDatabase, authed, ok, parseJson, withApi } from "@/lib/server/http";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import type { ChatPeer, ChatThread, ChatThreadSummary, SocialCompanion, UserProfile } from "@/types";

const createThreadSchema = z.object({
  userId: z.uuid().nullable().optional(),
  companionId: z.uuid().nullable().optional(),
}).refine((value) => Number(Boolean(value.userId)) + Number(Boolean(value.companionId)) === 1, {
  message: "Choose exactly one chat recipient.",
});

export async function GET(request: Request) {
  return withApi(async () => {
    const flags = await requireApiGate("chat");
    const { user, supabase } = await authed(request);
    // Only the thread kinds that are open, filtered before the page limit.
    let query = supabase.from("chat_threads").select("*");
    if (!flags.personaChat) query = query.is("companion_id", null);
    if (!flags.socialFeed) query = query.not("companion_id", "is", null);
    const threads = assertDatabase(await query
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(100)) as ChatThread[];

    const userIds = [...new Set(threads.flatMap((thread) => [thread.user_one_id, thread.user_two_id])
      .filter((id): id is string => Boolean(id) && id !== user.id))];
    const companionIds = [...new Set(threads.map((thread) => thread.companion_id)
      .filter((id): id is string => Boolean(id)))];
    const [profileResult, companionResult, favoriteResult] = await Promise.all([
      userIds.length
        ? supabase.from("user_profiles").select("id, username, display_name, avatar_url, bio").in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
      companionIds.length
        ? supabase.from("social_companions").select("id, slug, name, avatar_url, personality").in("id", companionIds)
        : Promise.resolve({ data: [], error: null }),
      companionIds.length
        ? supabase.from("user_companion_relationships").select("companion_id").eq("user_id", user.id).eq("is_favorite", true).in("companion_id", companionIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const profiles = assertDatabase(profileResult) as Array<Pick<UserProfile, "id" | "username" | "display_name" | "avatar_url" | "bio">>;
    const companions = assertDatabase(companionResult) as Array<Pick<SocialCompanion, "id" | "slug" | "name" | "avatar_url" | "personality">>;
    const favoriteCompanionIds = new Set((assertDatabase(favoriteResult) ?? []).map((relationship) => relationship.companion_id));
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
    }).map((item, index) => ({ item, index }))
      .sort((left, right) => Number(favoriteCompanionIds.has(right.item.thread.companion_id ?? "")) - Number(favoriteCompanionIds.has(left.item.thread.companion_id ?? "")) || left.index - right.index)
      .map(({ item }) => item);

    return ok({ items });
  });
}

export async function POST(request: Request) {
  return withApi(async () => {
    await requireApiGate("chat");
    const { user, supabase } = await authed(request);
    const input = await parseJson(request, createThreadSchema);
    // Checked before the rate limit so a refused thread kind spends no budget.
    await requireApiGate(input.companionId ? "persona_chat" : "social_feed");
    // Without this, one account could open a thread against every other user,
    // landing in each of their chat lists without ever sending a message.
    await enforceRateLimit(user.id, "thread:create", 20, 3600);
    const thread = assertDatabase(await supabase.rpc("get_or_create_chat_thread", {
      p_user_id: input.userId ?? null,
      p_companion_id: input.companionId ?? null,
    })) as ChatThread;
    return ok(thread, { status: 201 });
  });
}
