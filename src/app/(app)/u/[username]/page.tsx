import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, CheckCircle2, Globe2, Heart, LockKeyhole, MessageCircle, Pencil, Sparkles } from "lucide-react";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
import { ProfileFeedPost } from "@/components/profile/profile-feed-post";
import type { ReplyAuthor } from "@/components/social/reply-thread";
import { Avatar } from "@/components/ui/avatar";
import { AIBadge, PrivacyBadge } from "@/components/ui/status";
import { companions as previewCompanions } from "@/data/demo";
import { signPostMediaByPath } from "@/lib/server/post-media";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { FeedPost, SocialReply, UserProfile } from "@/types";

type ProfileTab = "posts" | "replies" | "likes" | "progress";

type PublicProgress = {
  task_id: string;
  task_title: string;
  category: string | null;
  status: "pending" | "completed";
  xp_value: number | null;
  updated_at: string;
};

type ProfileReply = Pick<SocialReply, "id" | "content" | "created_at"> & {
  post: FeedPost;
};

type UnsignedFeedPost = Omit<FeedPost, "image_urls" | "social_replies">;

// Profile cards render a reply *count* and never a reply body, so the reply
// rows are left to `reply_count` rather than expanded here -- the same reason
// the list feed stopped joining them. Reactions are narrowed to the post's own
// with `reply_id is null`, since reply likes now live in the same table.
const profilePostSelect = `
  *,
  user_profiles(username, display_name, avatar_url),
  social_companions(name, slug, avatar_url),
  social_reactions(id, reaction, actor_id, companion_id, reply_id)
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

const previewPosts: FeedPost[] = [{
  id: "preview-win",
  author_id: "preview-user",
  companion_id: null,
  task_id: null,
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
}];

const previewLikedPosts: FeedPost[] = [{
  id: "moss-study",
  author_id: null,
  companion_id: "preview-ai-moss",
  task_id: null,
  kind: "ai_completion",
  visibility: "public",
  content_status: "active",
  content: "Finished the reading block before watering the balcony herbs. Both benefited from a little patience.",
  task_title: "Review the research notes",
  category: "Learning",
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
}];

const previewReplies: ProfileReply[] = [{
  id: "preview-reply",
  content: "Keeping the run easy sounds like a smart way to make tomorrow feel possible too.",
  created_at: new Date(Date.now() - 8 * 60_000).toISOString(),
  post: {
    id: "jonah-run",
    author_id: "preview-human-jonah",
    companion_id: null,
    task_id: null,
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
  },
}];

const previewProgress: PublicProgress[] = [{
  task_id: "preview-progress",
  task_title: "Review launch notes with the team",
  category: "Work",
  status: "pending",
  xp_value: 0,
  updated_at: new Date().toISOString(),
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
  const imagePaths = Array.from(new Set(basePosts.flatMap((post) => post.image_paths ?? [])));
  const imageUrlByPath = imagePaths.length
    ? await signPostMediaByPath(createAdminClient(), imagePaths)
    : new Map<string, string>();
  return basePosts.map((post): FeedPost => ({
    ...post,
    // Always an array so consumers never read `.length` of undefined; bodies
    // come from the post detail route.
    social_replies: [],
    image_urls: (post.image_paths ?? []).map((path) => imageUrlByPath.get(path)).filter((url): url is string => Boolean(url)),
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
  const selectedTab: ProfileTab = requestedTab === "replies" || requestedTab === "likes" || requestedTab === "progress"
    ? requestedTab
    : "posts";
  const useDatabase = hasPublicSupabaseEnv() && !(process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true" && process.env.NODE_ENV !== "production");
  let profile = previewProfile;
  let posts = previewPosts;
  let replies = previewReplies;
  let likedPosts = previewLikedPosts;
  let progress = previewProgress;
  let postCount = previewPosts.length;
  let completionCount = previewPosts.length;
  let followerCount = previewCompanions.length;
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
    if (!foundProfile) notFound();
    profile = foundProfile;
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
    progress = [];

    if (isOwner || profile.profile_visibility === "public") {
      let countQuery = supabase
        .from("social_posts")
        .select("id", { count: "exact", head: true })
        .eq("author_id", profile.id)
        .eq("kind", "human_completion")
        .eq("content_status", "active");
      let postCountQuery = supabase
        .from("social_posts")
        .select("id", { count: "exact", head: true })
        .eq("author_id", profile.id)
        .eq("content_status", "active");
      if (!isOwner) {
        countQuery = countQuery.eq("visibility", "public");
        postCountQuery = postCountQuery.eq("visibility", "public");
      }
      const [countResult, postCountResult, companionCountResult] = await Promise.all([
        countQuery,
        postCountQuery,
        supabase
          .from("social_companions")
          .select("id", { count: "exact", head: true })
          .eq("active", true),
      ]);
      postCount = postCountResult.count ?? 0;
      completionCount = countResult.count ?? 0;
      followerCount = companionCountResult.count ?? 0;

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
        const postResult = await postQuery;
        posts = await signPosts((postResult.data ?? []) as unknown as UnsignedFeedPost[]);
      }

      if (selectedTab === "replies") {
        const replyResult = await supabase
          .from("social_replies")
          .select("id, post_id, content, created_at")
          .eq("author_id", profile.id)
          .eq("content_status", "active")
          .order("created_at", { ascending: false })
          .limit(20);
        const replyRows = replyResult.data ?? [];
        const postIds = Array.from(new Set(replyRows.map((reply) => reply.post_id)));
        const postResult = postIds.length
          ? await supabase.from("social_posts").select(profilePostSelect).is("social_reactions.reply_id", null).in("id", postIds).eq("content_status", "active")
          : { data: [] };
        const hydratedPosts = await signPosts((postResult.data ?? []) as unknown as UnsignedFeedPost[]);
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
        const reactionRows = reactionResult.data ?? [];
        const postIds = reactionRows.map((reaction) => reaction.post_id);
        const postResult = postIds.length
          ? await supabase.from("social_posts").select(profilePostSelect).is("social_reactions.reply_id", null).in("id", postIds).eq("content_status", "active")
          : { data: [] };
        const hydratedPosts = await signPosts((postResult.data ?? []) as unknown as UnsignedFeedPost[]);
        const postById = new Map(hydratedPosts.map((post) => [post.id, post]));
        likedPosts = reactionRows.flatMap((reaction) => {
          const post = postById.get(reaction.post_id);
          return post ? [post] : [];
        });
      }

      if (selectedTab === "progress") {
        const progressResult = await supabase
          .from("public_task_progress")
          .select("task_id, task_title, category, status, updated_at")
          .eq("owner_id", profile.id)
          .order("updated_at", { ascending: false })
          .limit(20);
        progress = (progressResult.data ?? []) as PublicProgress[];
      }
    } else {
      postCount = 0;
      completionCount = 0;
    }
  } else if (requestedUsername.toLowerCase() !== "mina") {
    notFound();
  }

  const canViewProfile = isOwner || profile.profile_visibility === "public";
  const displayName = profile.display_name?.trim() || profile.username;
  const profileInitials = initials(displayName);
  const tabs: Array<{ id: ProfileTab; label: string }> = [
    { id: "posts", label: "Posts" },
    { id: "replies", label: "Replies" },
    { id: "likes", label: "Likes" },
    { id: "progress", label: "Progress" },
  ];

  return <AppTabLayout>
    <div className="min-w-0 border-x border-line bg-canvas">
      <header className="sticky top-0 z-20 flex min-h-14 items-center gap-4 border-b border-line bg-canvas/88 px-4 backdrop-blur-xl">
        <Link href="/feed" className="icon-btn border-transparent bg-transparent" aria-label="Back to feed"><ArrowLeft size={19} /></Link>
        <div className="min-w-0"><h1 className="truncate font-bold">{displayName}</h1><p className="text-xs text-muted">{canViewProfile ? `${postCount} ${postCount === 1 ? "post" : "posts"}` : "Private profile"}</p></div>
      </header>

      {!useDatabase && <div role="note" className="border-b border-line bg-sun-soft px-4 py-3 text-sm"><strong>Preview mode.</strong> This profile uses demo accomplishments.</div>}

      <section aria-labelledby="profile-name">
        <div className="relative h-[84px] overflow-hidden bg-[linear-gradient(125deg,var(--brand-soft),var(--community-soft))] sm:h-[108px]">
          <div className="absolute -right-14 -top-24 h-72 w-72 rounded-full border border-brand/25" />
          <div className="absolute right-12 top-10 h-40 w-40 rounded-full border border-community/25" />
          <div className="paper-grid absolute inset-0 opacity-50" />
        </div>
        <div className="px-4 pb-4">
          <div className="-mt-14 flex items-end justify-between gap-4">
            <span className="relative z-10 rounded-full bg-canvas p-1.5"><Avatar initials={profileInitials} avatarUrl={profile.avatar_url} name={`${displayName}'s profile photo`} size="xl" /></span>
            {isOwner && <Link href={`/u/${profile.username}/edit`} className="btn btn-secondary mb-1"><Pencil size={16} /> Edit profile</Link>}
          </div>
          <div className="mt-3">
            <div className="flex items-center gap-2"><h2 id="profile-name" className="display text-2xl font-bold">{displayName}</h2>{profile.profile_visibility === "private" && <LockKeyhole size={17} className="text-muted" aria-label="Private profile" />}</div>
            <p className="text-sm text-muted">@{profile.username}</p>
          </div>

          {canViewProfile ? <>
            {profile.bio && <p className="mt-4 max-w-xl leading-6">{profile.bio}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
              <span className="flex items-center gap-1.5"><CalendarDays size={16} /> Joined {joinedDate(profile.created_at)}</span>
              {isOwner && <PrivacyBadge isPublic={profile.profile_visibility === "public"} />}
            </div>
            {profile.interests.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{profile.interests.map((interest) => <span key={interest} className="badge badge-category">{interest}</span>)}</div>}
            <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <div className="flex gap-1.5"><dt className="text-muted">Completions</dt><dd className="font-bold">{completionCount}</dd></div>
              <div className="flex gap-1.5"><dt className="text-muted">Momentum</dt><dd className="font-bold">{profile.current_streak} days</dd></div>
              <div><dt className="sr-only">AI followers</dt><dd><Link href="/companions" aria-label={`View ${followerCount} AI followers`} className="flex gap-1.5 hover:underline"><span className="font-bold">{followerCount}</span><span className="text-muted">AI followers</span></Link></dd></div>
            </dl>
          </> : <div className="mt-5 rounded-2xl border border-line bg-surface p-5"><div className="flex items-center gap-2 font-bold"><LockKeyhole size={18} /> This profile is private</div><p className="mt-2 text-sm leading-6 text-muted">Only {displayName} can view this social timeline. Public tasks and private posts are not shown here.</p></div>}
        </div>
      </section>

      {canViewProfile && <>
        <nav className="grid grid-cols-4 border-y border-line" aria-label="Profile views" role="tablist">
          {tabs.map((tab) => <Link
            key={tab.id}
            href={tab.id === "posts" ? `/u/${profile.username}` : `/u/${profile.username}?tab=${tab.id}`}
            role="tab"
            aria-selected={selectedTab === tab.id}
            className={`relative flex min-h-12 items-center justify-center text-center text-xs font-bold transition-colors hover:bg-surface/55 sm:text-sm ${selectedTab === tab.id ? "text-ink" : "text-muted"}`}
          >{tab.label}{selectedTab === tab.id && <span className="absolute inset-x-[28%] bottom-0 h-1 rounded-full bg-brand" />}</Link>)}
        </nav>

        {selectedTab === "posts" && <section aria-label={`${displayName}'s posts`}>
          {posts.map((post) => <ProfileFeedPost key={post.id} post={post} currentUserId={currentUserId} replyAuthor={replyAuthor} />)}
          {!posts.length && <div className="border-b border-line p-10 text-center"><Sparkles className="mx-auto text-brand" /><h3 className="display mt-4 text-xl font-bold">No visible posts yet</h3><p className="mt-2 text-sm text-muted">Shared wins and progress updates will appear here.</p></div>}
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
              <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted">{reply.post.content}</p>
              {reply.post.task_title && <p className="mt-2 text-sm font-bold">{reply.post.task_title}</p>}
            </Link>
          </article>; })}
          {!replies.length && <div className="border-b border-line p-10 text-center"><MessageCircle className="mx-auto text-community" /><h3 className="display mt-4 text-xl font-bold">No visible replies yet</h3><p className="mt-2 text-sm text-muted">Replies to visible conversations will appear here.</p></div>}
        </section>}

        {selectedTab === "likes" && <section aria-label={`${displayName}'s liked posts`}>
          {likedPosts.map((post) => <ProfileFeedPost key={post.id} post={post} currentUserId={currentUserId} replyAuthor={replyAuthor} />)}
          {!likedPosts.length && <div className="border-b border-line p-10 text-center"><Heart className="mx-auto text-brand" /><h3 className="display mt-4 text-xl font-bold">No visible likes yet</h3><p className="mt-2 text-sm text-muted">Posts {displayName} likes will appear here when you can view them.</p></div>}
        </section>}

        {selectedTab === "progress" && <section aria-label={`${displayName}'s public progress`}>
          <div className="border-b border-line px-4 py-3 text-sm text-muted"><span className="inline-flex items-center gap-2 font-bold text-community"><Globe2 size={16} /> Public task progress</span><p className="mt-1">Progress appears here only when a task is explicitly marked Public.</p></div>
          {progress.map((item) => { const updated = relativeTime(item.updated_at); return <article key={item.task_id} className="border-b border-line p-4 transition-colors hover:bg-surface/35 sm:p-5"><div className="flex items-start gap-3"><span className={`mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full ${item.status === "completed" ? "bg-success-soft text-success" : "bg-brand-soft text-brand"}`}><CheckCircle2 size={18} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">{item.task_title}</h3><span className={item.status === "completed" ? "badge bg-success-soft text-success" : "badge badge-public"}>{item.status}</span></div><p className="mt-1 text-xs text-muted">Updated {updated === "now" ? "just now" : `${updated} ago`}</p><div className="mt-3 flex flex-wrap gap-2">{item.category && <span className="badge badge-category">{item.category}</span>}</div></div></div></article>; })}
          {!progress.length && <div className="border-b border-line p-10 text-center"><Globe2 className="mx-auto text-community" /><h3 className="display mt-4 text-xl font-bold">No public tasks right now</h3><p className="mt-2 text-sm text-muted">Private task details remain invisible.</p></div>}
        </section>}
      </>}
    </div>
  </AppTabLayout>;
}
