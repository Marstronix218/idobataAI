import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
import { FollowEmptyState, PeopleFollowList, PersonaFollowList } from "@/components/profile/follow-list";
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
 *
 * The audience starts at `all` because the honest answer to "who follows this
 * account" is everyone who does. Landing on `people` made the AI half invisible
 * unless you already knew to look for it, and made the chips read as a
 * two-option switch you could not leave rather than as filters you turn on.
 */
export type FollowDirection = "followers" | "following";
export type FollowAudience = "all" | "people" | "ai";

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
  return audience === "all" ? `/u/${handle}/${direction}` : `/u/${handle}/${direction}?kind=${audience}`;
}

/** The bare route is the unfiltered list, so any `kind` we do not know is that. */
export function parseAudience(kind: string | undefined): FollowAudience {
  return kind === "ai" || kind === "people" ? kind : "all";
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
  "followers-all": (name, isOwner) => ({
    title: "No followers yet",
    body: isOwner
      ? "People and AI personas who follow you will appear here. Nothing you finish is shared until you choose to share it."
      : `Nobody follows ${name} yet.`,
  }),
  "following-all": (name, isOwner) => ({
    title: "Not following anyone yet",
    body: isOwner
      ? "Follow an account or an AI persona, and what they share will show up in your feed."
      : `${name} does not follow anyone yet.`,
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
  let personas: ProfileFollowPersona[] = audience === "people" ? [] : previewPersonas;
  // Each half pages on its own, so the unfiltered list cannot let one side's
  // "Show more" speak for the other.
  let peopleHasMore = false;
  let personasHasMore = false;

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
      // A filter drops one half's query entirely; the unfiltered list needs
      // both, and issuing them together costs one round trip rather than two.
      const wantsPeople = audience !== "ai";
      const wantsPersonas = audience !== "people";
      const [peopleRows, personaRows, favoriteRows] = await Promise.all([
        !wantsPeople ? null
          : direction === "following"
            ? supabase.rpc("list_profile_following", args)
            : supabase.rpc("list_profile_followers", args),
        !wantsPersonas ? null
          : direction === "following"
            ? supabase.rpc("list_profile_ai_following", args)
            : supabase.rpc("list_profile_ai_followers", args),
        // Only the owner can star a row, and only their own cap matters, so the
        // extra read is skipped for every other reader.
        wantsPersonas && isOwner ? supabase.rpc("list_profile_favorite_personas", { p_user_id: card.id }) : null,
      ]);

      if (peopleRows) {
        const rows = assertDatabase(peopleRows) ?? [];
        peopleHasMore = rows.length > PAGE_SIZE;
        people = peopleHasMore ? rows.slice(0, PAGE_SIZE) : rows;
      } else {
        people = [];
      }
      if (personaRows) {
        const rows = assertDatabase(personaRows) ?? [];
        personasHasMore = rows.length > PAGE_SIZE;
        personas = personasHasMore ? rows.slice(0, PAGE_SIZE) : rows;
      } else {
        personas = [];
      }
      if (favoriteRows) favoriteCount = (assertDatabase(favoriteRows) ?? []).length;
    } else {
      people = [];
      personas = [];
    }
  }

  const directions: Array<{ id: FollowDirection; label: string }> = [
    { id: "followers", label: "Followers" },
    { id: "following", label: "Following" },
  ];
  const audiences: Array<{ id: Exclude<FollowAudience, "all">; label: string; count: number }> = [
    { id: "people", label: "People", count: direction === "followers" ? counts.followers : counts.following },
    { id: "ai", label: "AI", count: direction === "followers" ? counts.aiFollowers : counts.aiFollowing },
  ];
  const empty = EMPTY_COPY[`${direction}-${audience}`](displayName, isOwner);
  // A filtered view keeps its own empty state -- "no AI followers" is a real
  // answer. The unfiltered view only shows an empty state when both halves are,
  // and otherwise hides the half that has nothing rather than stacking two
  // headings over two apologies.
  const showPeople = audience === "people" || (audience === "all" && people.length > 0);
  const showPersonas = audience === "ai" || (audience === "all" && personas.length > 0);
  const sectionHeading = "border-b border-line bg-canvas-deep/45 px-4 py-2 text-xs font-bold uppercase tracking-[.08em] text-muted";

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

      {/* Off by default: the list below is everyone. Tapping a chip narrows it,
          tapping the lit one clears it again, and the glow on the active chip's
          outline is what tells you which of the three you are looking at. */}
      <div className="flex items-center gap-2 border-b border-line px-4 py-3" role="group" aria-label="Filter by audience">
        {audiences.map((option) => {
          const active = audience === option.id;
          return <Link
            key={option.id}
            href={listHref(handle, direction, active ? "all" : option.id)}
            aria-current={active ? "true" : undefined}
            aria-label={active ? `${option.label} filter on, showing ${option.count}. Clear filter` : `Show ${option.label} only, ${option.count}`}
            className={`badge filter-chip min-h-9 gap-1.5 px-3 text-sm ${option.id === "ai" ? "filter-chip-ai" : ""} ${active ? "" : "text-muted hover:bg-surface/55"}`}
          >
            <span className="font-bold">{option.label}</span>
            <span>{option.count}</span>
          </Link>;
        })}
        <span className="ml-auto text-xs text-muted">{audience === "all" ? "Showing everyone" : "Filtered"}</span>
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
        : <>
          {!showPeople && !showPersonas && <FollowEmptyState title={empty.title} body={empty.body} />}
          {showPeople && <>
            {audience === "all" && <h2 className={sectionHeading}>People</h2>}
            <PeopleFollowList
              kind={direction}
              userId={userId}
              initialItems={people}
              initialHasMore={peopleHasMore}
              emptyTitle={empty.title}
              emptyBody={empty.body}
            />
          </>}
          {showPersonas && <>
            {audience === "all" && <h2 className={sectionHeading}>AI personas</h2>}
            <PersonaFollowList
              kind={direction === "followers" ? "ai-followers" : "ai-following"}
              userId={userId}
              canFavorite={isOwner}
              initialFavoriteCount={favoriteCount}
              initialItems={personas}
              initialHasMore={personasHasMore}
              emptyTitle={empty.title}
              emptyBody={empty.body}
            />
          </>}
        </>}
    </div>
  </AppTabLayout>;
}
