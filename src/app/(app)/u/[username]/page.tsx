import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, Heart, LockKeyhole, MessageCircle, Pencil, UserCheck } from "lucide-react";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
import { FavoritePersonas } from "@/components/profile/favorite-personas";
import { ProfileFeedPost } from "@/components/profile/profile-feed-post";
import { ProfileFollowButton } from "@/components/profile/profile-follow-button";
import type { ReplyAuthor } from "@/components/social/reply-thread";
import { Avatar } from "@/components/ui/avatar";
import { LogoMark } from "@/components/ui/logo";
import { AIBadge, PrivacyBadge } from "@/components/ui/status";
import { activeCompanions as previewCompanions } from "@/data/demo";
import { assertDatabase } from "@/lib/server/http";
import { signPostMediaByPath } from "@/lib/server/post-media";
import { toQuotedFeedPost } from "@/lib/domain/social-post";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { FeedPost, ProfileFollowPersona, QuotedFeedPost, SocialReply, UserProfile } from "@/types";

type ProfileTab = "posts" | "replies" | "likes";

type ProfileReply = Pick<SocialReply, "id" | "content" | "created_at"> & {
  post: FeedPost;
};

type ProfileTimelineItem = {
  key: string;
  activityAt: string;
  post: FeedPost;
  repostedBy?: string;
  repostActorId?: string;
};

type UnsignedQuotedPost = Omit<QuotedFeedPost, "image_urls">;
type UnsignedFeedPost = Omit<FeedPost, "image_urls" | "social_replies" | "quoted_post"> & {
  quoted_post: UnsignedQuotedPost | null;
};

// Profile cards render a reply *count* and never a reply body, so the reply
// rows are left to `reply_count` rather than expanded here -- the same reason
// the list feed stopped joining them. Reactions are narrowed to the post's own
// with `reply_id is null`, since reply likes now live in the same table.
const profilePostSelect = `
  *,
  user_profiles(username, display_name, avatar_url),
  social_companions(name, slug, avatar_url),
  social_reactions(id, reaction, actor_id, companion_id, reply_id),
  social_reposts(id, user_id:actor_id, companion_id, created_at, social_companions(name, slug)),
  quoted_post(
    *,
    user_profiles(username, display_name, avatar_url),
    social_companions(name, slug, avatar_url)
  )
`;

const previewProfile: UserProfile = {
  id: "preview-user",
  username: "mina",
  display_name: "Mina Mori",
  bio: "Building calmer routines, one honest win at a time.",
  avatar_url: null,
  profile_visibility: "public",
  daily_goal: 3,
  interests: ["Work", "Learning", "Wellbeing"],
  default_task_visibility: "private",
  completion_visibility: "private",
  xp: 2840,
  current_streak: 6,
  last_completion_date: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// The columns `get_profile_card` deliberately withholds. None of them are read
// on a restricted profile; they exist only so the card satisfies `UserProfile`.
const restrictedProfileDefaults = {
  daily_goal: 0,
  default_task_visibility: "private",
  completion_visibility: "private",
  xp: 0,
  last_completion_date: null,
  updated_at: "",
} satisfies Partial<UserProfile>;

const previewHumanFollowerCount = 3;
const previewHumanFollowingCount = 5;

// The card's strip is capped at three by the database, so preview mode takes
// the first three demo personas rather than all of them.
const previewFavoritePersonas: ProfileFollowPersona[] = previewCompanions.slice(0, 3).map((companion) => ({
  id: companion.id,
  slug: companion.id,
  name: companion.name,
  avatar_url: `/companions/${companion.id}.webp`,
  personality: companion.tagline,
  followed_at: new Date().toISOString(),
  viewer_follows: true,
  is_favorite: true,
}));

const previewPosts: FeedPost[] = [{
  id: "preview-win",
  author_id: "preview-user",
  companion_id: null,
  task_id: null,
  quoted_post_id: null,
  kind: "human_completion",
  visibility: "public",
  content_status: "active",
  content: "Wrapped the first draft before lunch. Tomorrow’s review now has something real to work with.",
  task_title: "Draft the project kickoff outline",
  category: "Work",
  xp_earned: 10,
  streak: 6,
  completed_at: new Date().toISOString(),
  idempotency_key: "preview",
  source_key: null,
  image_paths: [],
  image_urls: [],
  is_ai_generated: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  user_profiles: { username: "mina", display_name: "Mina Mori", avatar_url: null },
  social_companions: null,
  social_reactions: Array.from({ length: 3 }, (_, index) => ({
    id: `preview-win-like-${index}`,
    reaction: "like" as const,
    reply_id: null,
    actor_id: `preview-human-${index}`,
    companion_id: null,
  })),
  social_replies: [],
  reply_count: 0,
  quoted_post: null,
}];

const previewLikedPosts: FeedPost[] = [{
  id: "moss-study",
  author_id: null,
  companion_id: "preview-ai-moss",
  task_id: null,
  quoted_post_id: null,
  kind: "ai_completion",
  visibility: "public",
  content_status: "active",
  content: "I have observed seven generations of this city. None of them adequately explained derivatives.",
  task_title: "Survive the morning calculus lecture",
  category: "Human university",
  xp_earned: 15,
  streak: null,
  completed_at: new Date(Date.now() - 12 * 60_000).toISOString(),
  idempotency_key: null,
  source_key: "preview-completion:moss",
  image_paths: [],
  image_urls: [],
  is_ai_generated: true,
  created_at: new Date(Date.now() - 12 * 60_000).toISOString(),
  updated_at: new Date().toISOString(),
  user_profiles: null,
  social_companions: { name: "Moss", slug: "moss", avatar_url: "/companions/moss.webp" },
  social_reactions: Array.from({ length: 8 }, (_, index) => ({
    id: `moss-study-like-${index}`,
    reaction: "like" as const,
    reply_id: null,
    actor_id: index === 0 ? "preview-user" : index < 6 ? `preview-human-${index}` : null,
    companion_id: index >= 6 ? `preview-ai-${index}` : null,
  })),
  social_replies: [],
  reply_count: 0,
  quoted_post: null,
}];

const previewQuotedSource: QuotedFeedPost = toQuotedFeedPost(previewLikedPosts[0]);

const previewQuotePost: FeedPost = {
  id: "preview-quote",
  author_id: "preview-user",
  companion_id: null,
  task_id: null,
  quoted_post_id: previewQuotedSource.id,
  kind: "human_quote",
  visibility: "public",
  content_status: "active",
  content: "This is exactly the kind of patient progress I want to remember.",
  task_title: null,
  category: null,
  xp_earned: null,
  streak: null,
  completed_at: null,
  idempotency_key: "preview-quote",
  source_key: null,
  image_paths: [],
  image_urls: [],
  is_ai_generated: false,
  reply_count: 0,
  created_at: new Date(Date.now() - 2 * 60_000).toISOString(),
  updated_at: new Date().toISOString(),
  user_profiles: { username: "mina", display_name: "Mina Mori", avatar_url: null },
  social_companions: null,
  social_reactions: [],
  social_reposts: [],
  social_replies: [],
  quoted_post: previewQuotedSource,
};

const previewRepostAt = new Date(Date.now() - 4 * 60_000).toISOString();
const previewRepostedPost: FeedPost = {
  ...previewLikedPosts[0],
  social_reposts: [{
    id: "preview-repost",
    user_id: "preview-user",
    companion_id: null,
    created_at: previewRepostAt,
  }],
};

const previewTimeline: ProfileTimelineItem[] = [
  ...previewPosts.map((post) => ({ key: `post:${post.id}`, activityAt: post.created_at, post })),
  { key: `post:${previewQuotePost.id}`, activityAt: previewQuotePost.created_at, post: previewQuotePost },
  { key: "repost:preview-repost", activityAt: previewRepostAt, post: previewRepostedPost, repostedBy: "Mina Mori", repostActorId: "preview-user" },
].sort((left, right) => right.activityAt.localeCompare(left.activityAt));

const previewReplies: ProfileReply[] = [{
  id: "preview-reply",
  content: "Keeping the run easy sounds like a smart way to make tomorrow feel possible too.",
  created_at: new Date(Date.now() - 8 * 60_000).toISOString(),
  post: {
    id: "jonah-run",
    author_id: "preview-human-jonah",
    companion_id: null,
    task_id: null,
    quoted_post_id: null,
    kind: "human_completion",
    visibility: "public",
    content_status: "active",
    content: "Kept the run easy and came home with enough energy for breakfast. That was the actual goal.",
    task_title: "Run 3 km before work",
    category: "Fitness",
    xp_earned: 20,
    streak: null,
    completed_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    idempotency_key: null,
    source_key: null,
    image_paths: [],
    image_urls: [],
    is_ai_generated: false,
    created_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    updated_at: new Date().toISOString(),
    user_profiles: { username: "jonah", display_name: "Jonah", avatar_url: null },
    social_companions: null,
    social_reactions: Array.from({ length: 5 }, (_, index) => ({
      id: `jonah-run-like-${index}`,
      reaction: "like" as const,
      reply_id: null,
      actor_id: `preview-human-${index}`,
      companion_id: null,
    })),
    social_replies: [],
    reply_count: 0,
    quoted_post: null,
  },
}];

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

function joinedDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(value));
}

function initials(value: string) {
  return value.split(/[\s_-]+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

async function signPosts(basePosts: UnsignedFeedPost[]) {
  const imagePaths = Array.from(new Set(basePosts.flatMap((post) => [
    ...(post.image_paths ?? []),
    ...(post.quoted_post?.image_paths ?? []),
  ])));
  const imageUrlByPath = imagePaths.length
    ? await signPostMediaByPath(createAdminClient(), imagePaths)
    : new Map<string, string>();
  return basePosts.map((post): FeedPost => ({
    ...post,
    // Always an array so consumers never read `.length` of undefined; bodies
    // come from the post detail route.
    social_replies: [],
    image_urls: (post.image_paths ?? []).map((path) => imageUrlByPath.get(path)).filter((url): url is string => Boolean(url)),
    quoted_post: post.quoted_post ? {
      ...post.quoted_post,
      image_urls: (post.quoted_post.image_paths ?? []).map((path) => imageUrlByPath.get(path)).filter((url): url is string => Boolean(url)),
    } : null,
  }));
}

function postAuthor(post: FeedPost) {
  const companion = post.social_companions;
  const profile = post.user_profiles;
  return {
    name: companion?.name ?? profile?.display_name ?? profile?.username ?? "Community member",
    username: profile?.username ?? null,
    avatarUrl: companion?.avatar_url ?? profile?.avatar_url ?? null,
    isAI: Boolean(post.companion_id),
  };
}

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const requestedUsername = decodeURIComponent((await params).username);
  const requestedTab = (await searchParams).tab;
  const selectedTab: ProfileTab = requestedTab === "replies" || requestedTab === "likes"
    ? requestedTab
    : "posts";
  const useDatabase = hasPublicSupabaseEnv() && !(process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true" && process.env.NODE_ENV !== "production");
  let profile = previewProfile;
  let posts = previewTimeline;
  let replies = previewReplies;
  let likedPosts = previewLikedPosts;
  let postCount = previewTimeline.length;
  let completionCount = previewPosts.filter((post) => post.kind === "human_completion").length;
  let humanFollowerCount = previewHumanFollowerCount;
  let humanFollowingCount = previewHumanFollowingCount;
  let aiFollowingCount = previewCompanions.length;
  let favoritePersonas = previewFavoritePersonas;
  let viewerFollowsProfile = false;
  let viewerRequestedFollow = false;
  let pendingRequestCount = 0;
  let isOwner = true;
  let currentUserId: string | null = "preview-user";
  let replyAuthor: ReplyAuthor | null = {
    name: previewProfile.display_name?.trim() || previewProfile.username,
    username: previewProfile.username,
    avatarUrl: previewProfile.avatar_url,
  };

  if (useDatabase) {
    if (!/^[A-Za-z0-9_]{3,24}$/.test(requestedUsername)) notFound();
    const supabase = await createClient();
    const [{ data: viewer }, { data: foundProfile }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("user_profiles").select("*").ilike("username", requestedUsername).maybeSingle(),
    ]);
    let visibleProfile = foundProfile;
    if (!visibleProfile) {
      // `profiles_read` hides a private profile that has no public posts, but a
      // protected account is still a real, addressable person. The definer card
      // carries the identity without the columns privacy is actually about, so
      // the page can render a restricted profile instead of a 404.
      const cardResult = assertDatabase(await supabase.rpc("get_profile_card", { p_username: requestedUsername }));
      const card = cardResult?.[0];
      if (!card) notFound();
      visibleProfile = { ...restrictedProfileDefaults, ...card };
    }
    profile = visibleProfile;
    currentUserId = viewer.user?.id ?? null;
    isOwner = currentUserId === profile.id;
    if (!currentUserId) {
      replyAuthor = null;
    } else if (isOwner) {
      replyAuthor = { name: profile.display_name?.trim() || profile.username, username: profile.username, avatarUrl: profile.avatar_url };
    } else {
      const { data: viewerProfile } = await supabase
        .from("user_profiles")
        .select("username, display_name, avatar_url")
        .eq("id", currentUserId)
        .maybeSingle();
      replyAuthor = viewerProfile
        ? { name: viewerProfile.display_name?.trim() || viewerProfile.username, username: viewerProfile.username, avatarUrl: viewerProfile.avatar_url }
        : null;
    }
    posts = [];
    replies = [];
    likedPosts = [];

    // The counts describe the account rather than its posts, so a protected
    // profile reports them the same way Twitter does. Every query below is
    // already narrowed to `visibility = 'public'` for a stranger, so nothing a
    // private profile withholds is counted here.
    {
      const completionCountQuery = isOwner
        ? supabase
          .from("task_completion_awards")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", profile.id)
        : supabase
          .from("social_posts")
          .select("id", { count: "exact", head: true })
          .eq("author_id", profile.id)
          .eq("kind", "human_completion")
          .eq("content_status", "active")
          .eq("visibility", "public");
      let postCountQuery = supabase
        .from("social_posts")
        .select("id", { count: "exact", head: true })
        .eq("author_id", profile.id)
        .eq("content_status", "active");
      const repostCountQuery = supabase
        .from("social_reposts")
        .select("id", { count: "exact", head: true })
        .eq("actor_id", profile.id);
      if (!isOwner) {
        postCountQuery = postCountQuery.eq("visibility", "public");
      }
      const [countResult, postCountResult, repostCountResult, aiFollowingCountResult, followSummaryResult] = await Promise.all([
        completionCountQuery,
        postCountQuery,
        repostCountQuery,
        supabase.rpc("get_profile_ai_following_count", { p_user_id: profile.id }),
        supabase.rpc("get_profile_follow_summary", { p_user_id: profile.id }),
      ]);
      assertDatabase(countResult);
      assertDatabase(postCountResult);
      assertDatabase(repostCountResult);
      postCount = (postCountResult.count ?? 0) + (repostCountResult.count ?? 0);
      completionCount = countResult.count ?? 0;
      aiFollowingCount = assertDatabase(aiFollowingCountResult) ?? 0;
      // Visibility no longer withholds this row, so a missing one means the two
      // accounts have blocked each other. That should read as "no such profile"
      // rather than as a server fault, the same way the directory omits it.
      const followSummary = assertDatabase(followSummaryResult)?.[0];
      if (!followSummary) notFound();
      humanFollowerCount = followSummary.follower_count;
      humanFollowingCount = followSummary.following_count;
      viewerFollowsProfile = followSummary.viewer_follows;
      viewerRequestedFollow = followSummary.viewer_requested;
      pendingRequestCount = followSummary.pending_request_count;
    }

    // An approved follower reads a private profile the way anyone reads a
    // public one; everybody else gets the card above and nothing below it.
    if (isOwner || profile.profile_visibility === "public" || viewerFollowsProfile) {
      // The strip is part of the graph, not part of the counts, so it lives
      // behind the same gate as the timeline rather than beside the numbers.
      favoritePersonas = assertDatabase(await supabase.rpc("list_profile_favorite_personas", { p_user_id: profile.id })) ?? [];
      if (selectedTab === "posts") {
        let postQuery = supabase
          .from("social_posts")
          .select(profilePostSelect)
          .is("social_reactions.reply_id", null)
          .eq("author_id", profile.id)
          .eq("content_status", "active")
          .order("created_at", { ascending: false })
          .limit(20);
        if (!isOwner) postQuery = postQuery.eq("visibility", "public");
        const [postResult, repostResult] = await Promise.all([
          postQuery,
          supabase
            .from("social_reposts")
            .select("id, post_id, actor_id, created_at")
            .eq("actor_id", profile.id)
            .order("created_at", { ascending: false })
            .limit(20),
        ]);
        const authoredPosts = await signPosts((assertDatabase(postResult) ?? []) as unknown as UnsignedFeedPost[]);
        const repostRows = assertDatabase(repostResult) ?? [];
        const repostedPostIds = Array.from(new Set(repostRows.map((repost) => repost.post_id)));
        const repostedPostResult = repostedPostIds.length
          ? await supabase.from("social_posts").select(profilePostSelect).is("social_reactions.reply_id", null).in("id", repostedPostIds).eq("content_status", "active")
          : { data: [], error: null };
        const repostedPosts = await signPosts((assertDatabase(repostedPostResult) ?? []) as unknown as UnsignedFeedPost[]);
        const repostedPostById = new Map(repostedPosts.map((post) => [post.id, post]));
        posts = [
          ...authoredPosts.map((post): ProfileTimelineItem => ({ key: `post:${post.id}`, activityAt: post.created_at, post })),
          ...repostRows.flatMap((repost): ProfileTimelineItem[] => {
            const post = repostedPostById.get(repost.post_id);
            return post ? [{ key: `repost:${repost.id}`, activityAt: repost.created_at, post, repostedBy: profile.display_name?.trim() || profile.username, repostActorId: profile.id }] : [];
          }),
        ].sort((left, right) => right.activityAt.localeCompare(left.activityAt) || right.key.localeCompare(left.key)).slice(0, 20);
      }

      if (selectedTab === "replies") {
        const replyResult = await supabase
          .from("social_replies")
          .select("id, post_id, content, created_at")
          .eq("author_id", profile.id)
          .eq("content_status", "active")
          .order("created_at", { ascending: false })
          .limit(20);
        const replyRows = assertDatabase(replyResult) ?? [];
        const postIds = Array.from(new Set(replyRows.map((reply) => reply.post_id)));
        const postResult = postIds.length
          ? await supabase.from("social_posts").select(profilePostSelect).is("social_reactions.reply_id", null).in("id", postIds).eq("content_status", "active")
          : { data: [], error: null };
        const hydratedPosts = await signPosts((assertDatabase(postResult) ?? []) as unknown as UnsignedFeedPost[]);
        const postById = new Map(hydratedPosts.map((post) => [post.id, post]));
        replies = replyRows.flatMap((reply) => {
          const post = postById.get(reply.post_id);
          return post ? [{ id: reply.id, content: reply.content, created_at: reply.created_at, post }] : [];
        });
      }

      if (selectedTab === "likes") {
        const reactionResult = await supabase
          .from("social_reactions")
          .select("post_id, created_at")
          .eq("actor_id", profile.id)
          .eq("reaction", "like")
          .is("reply_id", null)
          .order("created_at", { ascending: false })
          .limit(20);
        const reactionRows = assertDatabase(reactionResult) ?? [];
        const postIds = reactionRows.map((reaction) => reaction.post_id);
        const postResult = postIds.length
          ? await supabase.from("social_posts").select(profilePostSelect).is("social_reactions.reply_id", null).in("id", postIds).eq("content_status", "active")
          : { data: [], error: null };
        const hydratedPosts = await signPosts((assertDatabase(postResult) ?? []) as unknown as UnsignedFeedPost[]);
        const postById = new Map(hydratedPosts.map((post) => [post.id, post]));
        likedPosts = reactionRows.flatMap((reaction) => {
          const post = postById.get(reaction.post_id);
          return post ? [post] : [];
        });
      }
    }
  } else if (requestedUsername.toLowerCase() !== "mina") {
    notFound();
  }

  const canViewProfile = isOwner || profile.profile_visibility === "public" || viewerFollowsProfile;
  const displayName = profile.display_name?.trim() || profile.username;
  const profileInitials = initials(displayName);
  const tabs: Array<{ id: ProfileTab; label: string }> = [
    { id: "posts", label: "Posts" },
    { id: "replies", label: "Replies" },
    { id: "likes", label: "Likes" },
  ];

  return <AppTabLayout>
    <div className="min-w-0 border-x border-line bg-canvas">
      <header className="sticky top-0 z-20 flex min-h-14 items-center gap-4 border-b border-line bg-canvas/88 px-4 backdrop-blur-xl">
        <Link href="/feed" className="icon-btn border-transparent bg-transparent" aria-label="Back to feed"><ArrowLeft size={19} /></Link>
        <div className="min-w-0"><h1 className="truncate font-bold">{displayName}</h1><p className="text-xs text-muted">{postCount} {postCount === 1 ? "post" : "posts"}</p></div>
      </header>

      {!useDatabase && <div role="note" className="border-b border-line bg-sun-soft px-4 py-3 text-sm"><strong>Preview mode.</strong> This profile uses demo accomplishments.</div>}

      <section aria-labelledby="profile-name">
        <div className="relative h-[84px] overflow-hidden bg-[linear-gradient(125deg,var(--brand-soft),var(--community-soft))] sm:h-[108px]">
          <div className="absolute -right-14 -top-24 h-72 w-72 rounded-full border border-brand/25" />
          <div className="absolute right-12 top-10 h-40 w-40 rounded-full border border-community/25" />
          <div className="paper-grid absolute inset-0 opacity-50" />
        </div>
        <div className="px-4 pb-4">
          <div className="-mt-14 flex items-end justify-between gap-3 sm:gap-4">
            <span className="relative z-10 shrink-0 rounded-full bg-canvas p-1.5"><Avatar initials={profileInitials} avatarUrl={profile.avatar_url} name={`${displayName}'s profile photo`} size="xl" /></span>
            <div className="ml-auto shrink-0">
              {isOwner && <Link href={`/u/${profile.username}/edit`} className="btn btn-secondary mb-1"><Pencil size={16} /> Edit profile</Link>}
              {!isOwner && currentUserId && <ProfileFollowButton
                userId={profile.id}
                profileName={displayName}
                initialState={viewerFollowsProfile ? "following" : viewerRequestedFollow ? "requested" : "none"}
                isPrivate={profile.profile_visibility === "private"}
              />}
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-center gap-2"><h2 id="profile-name" className="display text-2xl font-bold">{displayName}</h2>{profile.profile_visibility === "private" && <LockKeyhole size={17} className="text-muted" aria-label="Private profile" />}</div>
            <p className="text-sm text-muted">@{profile.username}</p>
          </div>

          {/* The card describes the person, not their posts, so it renders for
              everyone. Protecting a profile withholds the timeline below, not
              the fact that its owner exists. */}
          {profile.bio && <p className="mt-4 max-w-xl leading-6">{profile.bio}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
            <span className="flex items-center gap-1.5"><CalendarDays size={16} /> Joined {joinedDate(profile.created_at)}</span>
            {isOwner && <PrivacyBadge isPublic={profile.profile_visibility === "public"} />}
          </div>
          {profile.interests.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{profile.interests.map((interest) => <span key={interest} className="badge badge-category">{interest}</span>)}</div>}
          {/* Two counts, both human. Merging people and personas would make the
              number that matters -- how many people are actually watching --
              unreadable, but a third and fourth number for the AI side made the
              card a wall of digits nobody parsed. The AI graph moved one level
              down instead: each count opens a list that is split by audience,
              and the part of it worth naming on the card is the favorites strip
              below, which the cap of three keeps to a single line. */}
          <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <div className="flex gap-1.5"><dt className="text-muted">Completions</dt><dd className="font-bold">{completionCount}</dd></div>
            <div className="flex gap-1.5"><dt className="text-muted">Momentum</dt><dd className="font-bold">{profile.current_streak} days</dd></div>
            <div><dt className="sr-only">Human followers</dt><dd><Link href={`/u/${profile.username}/followers`} aria-label={`View ${humanFollowerCount} followers`} className="flex gap-1.5 hover:underline"><span className="font-bold">{humanFollowerCount}</span><span className="text-muted">{humanFollowerCount === 1 ? "Follower" : "Followers"}</span></Link></dd></div>
            <div><dt className="sr-only">People followed</dt><dd><Link href={`/u/${profile.username}/following`} aria-label={`View the ${humanFollowingCount} accounts ${displayName} follows`} className="flex gap-1.5 hover:underline"><span className="font-bold">{humanFollowingCount}</span><span className="text-muted">Following</span></Link></dd></div>
          </dl>

          {canViewProfile && <FavoritePersonas
            username={profile.username}
            personas={favoritePersonas}
            isOwner={isOwner}
            followingCount={aiFollowingCount}
          />}

          {isOwner && pendingRequestCount > 0 && <Link href="/follow-requests" className="mt-4 flex items-center gap-2 rounded-2xl border border-line bg-surface p-4 text-sm font-bold transition-colors hover:bg-surface/70">
            <UserCheck size={18} className="text-community" />
            {pendingRequestCount} {pendingRequestCount === 1 ? "person is" : "people are"} waiting to follow you
          </Link>}
        </div>
      </section>

      {!canViewProfile && <section aria-labelledby="protected-posts" className="border-t border-line px-6 py-14 text-center">
        <LockKeyhole size={26} className="mx-auto text-muted" />
        <h2 id="protected-posts" className="display mt-4 text-2xl font-bold">These posts are protected</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted">
          Only approved followers can see @{profile.username}&rsquo;s posts, replies, and likes.
          {currentUserId && !isOwner && (viewerRequestedFollow ? " Your request is waiting for them." : " To ask for access, tap Follow.")}
        </p>
      </section>}

      {canViewProfile && <>
        <nav className="grid grid-cols-3 border-y border-line" aria-label="Profile views" role="tablist">
          {tabs.map((tab) => <Link
            key={tab.id}
            href={tab.id === "posts" ? `/u/${profile.username}` : `/u/${profile.username}?tab=${tab.id}`}
            role="tab"
            aria-selected={selectedTab === tab.id}
            className={`relative flex min-h-12 items-center justify-center text-center text-xs font-bold transition-colors hover:bg-surface/55 sm:text-sm ${selectedTab === tab.id ? "text-ink" : "text-muted"}`}
          >{tab.label}{selectedTab === tab.id && <span className="absolute inset-x-[28%] bottom-0 h-1 rounded-full bg-brand" />}</Link>)}
        </nav>

        {selectedTab === "posts" && <section aria-label={`${displayName}'s posts`}>
          {posts.map((item) => <ProfileFeedPost key={item.key} post={item.post} currentUserId={currentUserId} replyAuthor={replyAuthor} repostedBy={item.repostedBy} repostActorId={item.repostActorId} />)}
          {!posts.length && <div className="border-b border-line p-10 text-center"><LogoMark size={40} className="mx-auto" /><h3 className="display mt-4 text-xl font-bold">No visible posts yet</h3><p className="mt-2 text-sm text-muted">Posts, reposts, and shared wins will appear here.</p></div>}
        </section>}

        {selectedTab === "replies" && <section aria-label={`${displayName}'s replies`}>
          {replies.map((reply) => { const author = postAuthor(reply.post); return <article key={reply.id} className="border-b border-line p-4 transition-colors hover:bg-surface/35 sm:p-5">
            <header className="flex items-start gap-3">
              <Avatar initials={profileInitials} avatarUrl={profile.avatar_url} name={displayName} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-1.5"><span className="truncate font-bold">{displayName}</span><span className="truncate text-sm text-muted">@{profile.username}</span><span className="text-sm text-muted">· {relativeTime(reply.created_at)}</span></div>
                <p className="mt-0.5 text-xs text-muted">Replied</p>
              </div>
            </header>
            <p className="mt-4 leading-7">{reply.content}</p>
            <Link href={`/posts/${encodeURIComponent(reply.post.id)}`} aria-label={`View conversation with ${author.name}`} className="mt-4 block rounded-2xl border border-line bg-surface/65 p-4 transition-colors hover:bg-surface">
              <div className="flex items-center gap-2 text-sm">
                <Avatar initials={initials(author.name)} avatarUrl={author.avatarUrl} ai={author.isAI} name={author.name} size="sm" />
                <span className="font-bold">{author.name}</span>
                {author.isAI && <AIBadge />}
                {author.username && <span className="text-muted">@{author.username}</span>}
              </div>
              {reply.post.content && <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted">{reply.post.content}</p>}
              {reply.post.task_title && <p className="mt-2 text-sm font-bold">{reply.post.task_title}</p>}
            </Link>
          </article>; })}
          {!replies.length && <div className="border-b border-line p-10 text-center"><MessageCircle className="mx-auto text-community" /><h3 className="display mt-4 text-xl font-bold">No visible replies yet</h3><p className="mt-2 text-sm text-muted">Replies to visible conversations will appear here.</p></div>}
        </section>}

        {selectedTab === "likes" && <section aria-label={`${displayName}'s liked posts`}>
          {likedPosts.map((post) => <ProfileFeedPost key={post.id} post={post} currentUserId={currentUserId} replyAuthor={replyAuthor} />)}
          {!likedPosts.length && <div className="border-b border-line p-10 text-center"><Heart className="mx-auto text-brand" /><h3 className="display mt-4 text-xl font-bold">No visible likes yet</h3><p className="mt-2 text-sm text-muted">Posts {displayName} likes will appear here when you can view them.</p></div>}
        </section>}
      </>}
    </div>
  </AppTabLayout>;
}
