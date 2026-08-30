import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
import { PeopleFollowList, PersonaFollowList } from "@/components/profile/follow-list";
import { activeCompanions } from "@/data/demo";
import { assertDatabase } from "@/lib/server/http";
import { hasPublicSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { ProfileFollowPerson, ProfileFollowPersona } from "@/types";

const PAGE_SIZE = 30;

/**
 * The graph has two axes, and the page splits them the way they read: the
 * direction is the page you are on, the audience is a filter across both. Four
 * top-level tabs would mix the axes -- `AI followers` next to `Following` is a
 * direction-and-audience next to a direction -- and leave no room for the
 * fourth quadrant at all.
 */
export type FollowDirection = "followers" | "following";
export type FollowAudience = "people" | "ai";

const previewPeople: ProfileFollowPerson[] = [
  { id: "preview-amara", username: "amara", display_name: "Amara Osei", avatar_url: null, bio: "Marathon training and slow mornings.", profile_visibility: "public", followed_at: new Date().toISOString(), viewer_follows: false, viewer_requested: false, is_viewer: false },
  { id: "preview-jonah", username: "jonah", display_name: "Jonah Reed", avatar_url: null, bio: "Shipping one small thing a day.", profile_visibility: "private", followed_at: new Date().toISOString(), viewer_follows: true, viewer_requested: false, is_viewer: false },
  { id: "preview-noor", username: "noor", display_name: "Noor Haddad", avatar_url: null, bio: "Studying at night, resting on purpose.", profile_visibility: "public", followed_at: new Date().toISOString(), viewer_follows: false, viewer_requested: true, is_viewer: false },
];

// The first three stand in for the favorites the card shows, so preview mode
// does not contradict itself between the strip and the list it opens.
const previewPersonas: ProfileFollowPersona[] = activeCompanions.map((companion, index) => ({
  id: companion.id,
  slug: companion.id,
  name: companion.name,
  avatar_url: `/companions/${companion.id}.webp`,
  personality: companion.tagline,
  followed_at: new Date().toISOString(),
  viewer_follows: false,
  is_favorite: index < 3,
}));

function listHref(username: string, direction: FollowDirection, audience: FollowAudience) {
  const handle = encodeURIComponent(username);
  return audience === "ai" ? `/u/${handle}/${direction}?kind=ai` : `/u/${handle}/${direction}`;
}

const EMPTY_COPY: Record<`${FollowDirection}-${FollowAudience}`, (name: string, isOwner: boolean) => { title: string; body: string }> = {
  "followers-people": (name, isOwner) => ({
    title: "No followers yet",
    body: isOwner
      ? "People who follow you will appear here. Nothing you finish is shared until you choose to share it."
      : `Nobody follows ${name} yet.`,
  }),
  "followers-ai": (name, isOwner) => ({
    title: "No AI followers yet",
    body: isOwner
      ? "AI personas you follow may follow you back, and then they appear here."
      : `No AI persona follows ${name} yet.`,
  }),
  "following-people": (name, isOwner) => ({
    title: "Not following anyone yet",
    body: isOwner
      ? "Search for an account to follow, and their shared wins will show up in your feed."
      : `${name} does not follow anyone yet.`,
  }),
  "following-ai": (name, isOwner) => ({
    title: "No AI personas yet",
    body: isOwner
      ? "Follow a persona from the directory, then star up to three to show them on your profile."
      : `${name} does not follow any AI persona yet.`,
  }),
};

/**
 * The body behind the profile card's counts and its favorites strip, shared by
 * `/u/<handle>/followers` and `/u/<handle>/following`.
 *
 * The counts themselves describe the account and are shown to anyone, the way
 * a protected account's counts are. These lists are the social graph, which is
 * what protecting a profile actually withholds -- so the gate here is the
 * timeline's (owner, public, or approved follower), and the definer functions
 * enforce the same thing again on the server.
 */
export async function FollowPage({ username, direction, audience }: {
  username: string;
  direction: FollowDirection;
  audience: FollowAudience;
}) {
  const useDatabase = hasPublicSupabaseEnv() && !(process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true" && process.env.NODE_ENV !== "production");

  let displayName = "Mina Mori";
  let handle = "mina";
  let userId = "preview-user";
  let isOwner = true;
  let isPrivate = false;
  let canView = true;
  let viewerRequested = false;
  // Matches the profile header's own preview counts, so demo mode does not
  // contradict itself between the card and the list.
  let counts = { followers: 3, following: 5, aiFollowers: previewPersonas.length, aiFollowing: previewPersonas.length };
  let favoriteCount = previewPersonas.filter((persona) => persona.is_favorite).length;
  let people: ProfileFollowPerson[] = audience === "ai" ? [] : previewPeople;
  let personas: ProfileFollowPersona[] = audience === "ai" ? previewPersonas : [];
  let hasMore = false;

  if (useDatabase) {
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) notFound();
    const supabase = await createClient();
    const [{ data: viewer }, { data: foundProfile }] = await Promise.all([
      supabase.auth.getUser(),
      supabase
        .from("user_profiles")
        .select("id, username, display_name, profile_visibility")
        .ilike("username", username)
        .maybeSingle(),
    ]);
    const viewerId = viewer.user?.id ?? null;
    if (!viewerId) notFound();

    // Same fallback as the profile page: `profiles_read` hides a private
    // profile with no public posts, but the definer card still names it.
    let card = foundProfile;
    if (!card) {
      const cardResult = assertDatabase(await supabase.rpc("get_profile_card", { p_username: username }))?.[0];
      if (!cardResult) notFound();
      card = {
        id: cardResult.id,
        username: cardResult.username,
        display_name: cardResult.display_name,
        profile_visibility: cardResult.profile_visibility,
      };
    }

    userId = card.id;
    handle = card.username;
    displayName = card.display_name?.trim() || card.username;
    isOwner = viewerId === card.id;
    isPrivate = card.profile_visibility === "private";

    const [summaryResult, aiFollowerResult, aiFollowingResult] = await Promise.all([
      supabase.rpc("get_profile_follow_summary", { p_user_id: card.id }),
      supabase.rpc("get_profile_ai_follower_count", { p_user_id: card.id }),
      supabase.rpc("get_profile_ai_following_count", { p_user_id: card.id }),
    ]);
    // A missing summary row means the two accounts have blocked each other,
    // which reads as "no such profile" rather than as a server fault.
    const summary = assertDatabase(summaryResult)?.[0];
    if (!summary) notFound();
    counts = {
      followers: summary.follower_count,
      following: summary.following_count,
      aiFollowers: assertDatabase(aiFollowerResult) ?? 0,
      aiFollowing: assertDatabase(aiFollowingResult) ?? 0,
    };
    viewerRequested = summary.viewer_requested;
    canView = isOwner || !isPrivate || summary.viewer_follows;
    favoriteCount = 0;

    if (canView) {
      // One extra row answers "is there another page" without a second count.
      // The branches name their function rather than indexing a map, so the row
      // type stays narrowed instead of collapsing to a union of both shapes.
      const args = { p_user_id: card.id, p_limit: PAGE_SIZE + 1, p_offset: 0 };
      if (audience === "ai") {
        const rows = direction === "followers"
          ? assertDatabase(await supabase.rpc("list_profile_ai_followers", args)) ?? []
          : assertDatabase(await supabase.rpc("list_profile_ai_following", args)) ?? [];
        hasMore = rows.length > PAGE_SIZE;
        personas = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
        people = [];
        // Only the owner can star a row, and only their own cap matters, so the
        // extra read is skipped for every other reader.
        if (isOwner) {
          favoriteCount = (assertDatabase(await supabase.rpc("list_profile_favorite_personas", { p_user_id: card.id })) ?? []).length;
        }
      } else if (direction === "following") {
        const rows = assertDatabase(await supabase.rpc("list_profile_following", args)) ?? [];
        hasMore = rows.length > PAGE_SIZE;
        people = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
        personas = [];
      } else {
        const rows = assertDatabase(await supabase.rpc("list_profile_followers", args)) ?? [];
        hasMore = rows.length > PAGE_SIZE;
        people = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
        personas = [];
      }
    } else {
      people = [];
      personas = [];
    }
  }

  const directions: Array<{ id: FollowDirection; label: string }> = [
    { id: "followers", label: "Followers" },
    { id: "following", label: "Following" },
  ];
  const audiences: Array<{ id: FollowAudience; label: string; count: number }> = [
    { id: "people", label: "People", count: direction === "followers" ? counts.followers : counts.following },
    { id: "ai", label: "AI", count: direction === "followers" ? counts.aiFollowers : counts.aiFollowing },
  ];
  const empty = EMPTY_COPY[`${direction}-${audience}`](displayName, isOwner);

  return <AppTabLayout>
    <div className="min-w-0 border-x border-line bg-canvas">
      <header className="sticky top-0 z-20 flex min-h-14 items-center gap-4 border-b border-line bg-canvas/88 px-4 backdrop-blur-xl">
        <Link href={`/u/${encodeURIComponent(handle)}`} className="icon-btn border-transparent bg-transparent" aria-label={`Back to ${displayName}'s profile`}><ArrowLeft size={19} /></Link>
        <div className="min-w-0">
          <h1 className="truncate font-bold">{displayName}</h1>
          <p className="truncate text-xs text-muted">@{handle}</p>
        </div>
      </header>

      {!useDatabase && <div role="note" className="border-b border-line bg-sun-soft px-4 py-3 text-sm"><strong>Preview mode.</strong> These follows are demo data.</div>}

      {/* Direction on top, audience underneath. People and personas stay in
          separate lists because a number that silently mixes them is the vanity
          metric this product is trying not to be -- and because the rows carry
          different controls. Each count is printed once, on its own chip. */}
      <nav className="grid grid-cols-2 border-b border-line" aria-label="Follow direction" role="tablist">
        {directions.map((tab) => <Link
          key={tab.id}
          href={listHref(handle, tab.id, audience)}
          role="tab"
          aria-selected={direction === tab.id}
          className={`relative flex min-h-12 items-center justify-center text-center text-sm font-bold transition-colors hover:bg-surface/55 ${direction === tab.id ? "text-ink" : "text-muted"}`}
        >
          {tab.label}
          {direction === tab.id && <span className="absolute inset-x-[28%] bottom-0 h-1 rounded-full bg-brand" />}
        </Link>)}
      </nav>

      <div className="flex gap-2 border-b border-line px-4 py-3" role="group" aria-label="Filter by audience">
        {audiences.map((option) => <Link
          key={option.id}
          href={listHref(handle, direction, option.id)}
          aria-current={audience === option.id ? "true" : undefined}
          className={`badge min-h-9 gap-1.5 px-3 text-sm transition-colors ${audience === option.id ? "border-brand bg-brand-soft text-ink" : "text-muted hover:bg-surface/55"}`}
        >
          <span className="font-bold">{option.label}</span>
          <span>{option.count}</span>
        </Link>)}
      </div>

      {!canView
        ? <section aria-labelledby="protected-follows" className="px-6 py-14 text-center">
          <LockKeyhole size={26} className="mx-auto text-muted" aria-hidden="true" />
          <h2 id="protected-follows" className="display mt-4 text-2xl font-bold">This list is protected</h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted">
            Only approved followers can see who @{handle} follows and is followed by.
            {viewerRequested ? " Your request is waiting for them." : " To ask for access, tap Follow on their profile."}
          </p>
        </section>
        : audience === "ai"
          ? <PersonaFollowList
            kind={direction === "followers" ? "ai-followers" : "ai-following"}
            userId={userId}
            canFavorite={isOwner}
            initialFavoriteCount={favoriteCount}
            initialItems={personas}
            initialHasMore={hasMore}
            emptyTitle={empty.title}
            emptyBody={empty.body}
          />
          : <PeopleFollowList
            kind={direction}
            userId={userId}
            initialItems={people}
            initialHasMore={hasMore}
            emptyTitle={empty.title}
            emptyBody={empty.body}
          />}
    </div>
  </AppTabLayout>;
}
