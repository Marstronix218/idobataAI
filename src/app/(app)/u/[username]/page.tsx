import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, CheckCircle2, Flame, Globe2, Heart, LockKeyhole, MessageCircle, Pencil, Sparkles } from "lucide-react";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
import { PostMediaGrid } from "@/components/social/post-media-grid";
import { Avatar } from "@/components/ui/avatar";
import { PrivacyBadge } from "@/components/ui/status";
import { companions as previewCompanions } from "@/data/demo";
import { signPostMediaByPath } from "@/lib/server/post-media";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { SocialPost, UserProfile } from "@/types";

type PublicProgress = {
  task_id: string;
  task_title: string;
  category: string | null;
  status: "pending" | "completed";
  xp_value: number | null;
  updated_at: string;
};

type ProfilePost = SocialPost & {
  image_urls: string[];
  reaction_count: number;
  reply_count: number;
};

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

const previewPosts: ProfilePost[] = [{
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
  reaction_count: 3,
  reply_count: 1,
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

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const requestedUsername = decodeURIComponent((await params).username);
  const selectedTab = (await searchParams).tab === "progress" ? "progress" : "posts";
  const useDatabase = hasPublicSupabaseEnv() && !(process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true" && process.env.NODE_ENV !== "production");
  let profile = previewProfile;
  let posts = previewPosts;
  let progress = previewProgress;
  let postCount = previewPosts.length;
  let completionCount = previewPosts.length;
  let followerCount = previewCompanions.length;
  let isOwner = true;

  if (useDatabase) {
    if (!/^[A-Za-z0-9_]{3,24}$/.test(requestedUsername)) notFound();
    const supabase = await createClient();
    const [{ data: viewer }, { data: foundProfile }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("user_profiles").select("*").ilike("username", requestedUsername).maybeSingle(),
    ]);
    if (!foundProfile) notFound();
    profile = foundProfile;
    isOwner = viewer.user?.id === profile.id;

    if (isOwner || profile.profile_visibility === "public") {
      let postQuery = supabase
        .from("social_posts")
        .select("*")
        .eq("author_id", profile.id)
        .eq("content_status", "active")
        .order("created_at", { ascending: false })
        .limit(20);
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
        postQuery = postQuery.eq("visibility", "public");
        countQuery = countQuery.eq("visibility", "public");
        postCountQuery = postCountQuery.eq("visibility", "public");
      }
      const [postResult, countResult, postCountResult, progressResult, companionCountResult] = await Promise.all([
        postQuery,
        countQuery,
        postCountQuery,
        supabase
          .from("public_task_progress")
          .select("task_id, task_title, category, status, updated_at")
          .eq("owner_id", profile.id)
          .order("updated_at", { ascending: false })
          .limit(20),
        supabase
          .from("social_companions")
          .select("id", { count: "exact", head: true })
          .eq("active", true),
      ]);
      const basePosts = (postResult.data ?? []) as SocialPost[];
      const postIds = basePosts.map((post) => post.id);
      const [reactionResult, replyResult] = postIds.length ? await Promise.all([
        supabase.from("social_reactions").select("post_id").in("post_id", postIds),
        supabase.from("social_replies").select("post_id").in("post_id", postIds).eq("content_status", "active"),
      ]) : [{ data: [] }, { data: [] }];
      const reactionCounts = new Map<string, number>();
      const replyCounts = new Map<string, number>();
      for (const item of reactionResult.data ?? []) reactionCounts.set(item.post_id, (reactionCounts.get(item.post_id) ?? 0) + 1);
      for (const item of replyResult.data ?? []) replyCounts.set(item.post_id, (replyCounts.get(item.post_id) ?? 0) + 1);
      const admin = createAdminClient();
      const imagePaths = Array.from(new Set(basePosts.flatMap((post) => post.image_paths ?? [])));
      const imageUrlByPath = await signPostMediaByPath(admin, imagePaths);
      posts = basePosts.map((post) => ({
        ...post,
        image_urls: (post.image_paths ?? []).map((path) => imageUrlByPath.get(path)).filter((url): url is string => Boolean(url)),
        reaction_count: reactionCounts.get(post.id) ?? 0,
        reply_count: replyCounts.get(post.id) ?? 0,
      }));
      postCount = postCountResult.count ?? 0;
      completionCount = countResult.count ?? 0;
      followerCount = companionCountResult.count ?? 0;
      progress = (progressResult.data ?? []) as PublicProgress[];
    } else {
      posts = [];
      progress = [];
      postCount = 0;
      completionCount = 0;
    }
  } else if (requestedUsername.toLowerCase() !== "mina") {
    notFound();
  }

  const canViewProfile = isOwner || profile.profile_visibility === "public";
  const displayName = profile.display_name?.trim() || profile.username;
  const initials = displayName.slice(0, 2).toUpperCase();

  return <AppTabLayout>
    <div className="min-w-0 border-x border-line bg-canvas">
      <header className="sticky top-0 z-20 flex min-h-14 items-center gap-4 border-b border-line bg-canvas/88 px-4 backdrop-blur-xl">
        <Link href="/feed" className="icon-btn border-transparent bg-transparent" aria-label="Back to feed"><ArrowLeft size={19} /></Link>
        <div className="min-w-0"><h1 className="truncate font-bold">{displayName}</h1><p className="text-xs text-muted">{canViewProfile ? `${postCount} ${postCount === 1 ? "post" : "posts"}` : "Private profile"}</p></div>
      </header>

      {!useDatabase && <div role="note" className="border-b border-line bg-sun-soft px-4 py-3 text-sm"><strong>Preview mode.</strong> This profile uses demo accomplishments.</div>}

      <section aria-labelledby="profile-name">
        <div className="relative h-40 overflow-hidden bg-[linear-gradient(125deg,var(--brand-soft),var(--community-soft))] sm:h-48">
          <div className="absolute -right-14 -top-24 h-72 w-72 rounded-full border border-brand/25" />
          <div className="absolute right-12 top-10 h-40 w-40 rounded-full border border-community/25" />
          <div className="paper-grid absolute inset-0 opacity-50" />
        </div>
        <div className="px-4 pb-4">
          <div className="-mt-14 flex items-end justify-between gap-4">
            <span className="relative z-10 rounded-full bg-canvas p-1.5"><Avatar initials={initials} avatarUrl={profile.avatar_url} name={`${displayName}'s profile photo`} size="xl" /></span>
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
        <nav className="grid grid-cols-2 border-y border-line" aria-label="Profile views">
          <Link href={`/u/${profile.username}`} role="tab" aria-selected={selectedTab === "posts"} className={`relative flex min-h-12 items-center justify-center text-center text-sm font-bold transition-colors hover:bg-surface/55 ${selectedTab === "posts" ? "text-ink" : "text-muted"}`}>Posts{selectedTab === "posts" && <span className="absolute inset-x-[35%] bottom-0 h-1 rounded-full bg-brand" />}</Link>
          <Link href={`/u/${profile.username}?tab=progress`} role="tab" aria-selected={selectedTab === "progress"} className={`relative flex min-h-12 items-center justify-center text-center text-sm font-bold transition-colors hover:bg-surface/55 ${selectedTab === "progress" ? "text-ink" : "text-muted"}`}>Progress{selectedTab === "progress" && <span className="absolute inset-x-[35%] bottom-0 h-1 rounded-full bg-brand" />}</Link>
        </nav>

        {selectedTab === "posts" ? <section aria-label={`${displayName}'s posts`}>
          {posts.map((post) => <article key={post.id} className="border-b border-line p-4 transition-colors hover:bg-surface/35 sm:p-5">
            <header className="flex items-start gap-3">
              <Avatar initials={initials} avatarUrl={profile.avatar_url} name={displayName} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1"><span className="truncate font-bold">{displayName}</span><span className="truncate text-sm text-muted">@{profile.username}</span><span className="text-sm text-muted">· {relativeTime(post.created_at)}</span>{isOwner && <PrivacyBadge isPublic={post.visibility === "public"} />}</div>
                <p className="mt-0.5 text-xs text-muted">{post.kind.includes("completion") ? "Completed a task" : "Progress update"}</p>
              </div>
            </header>
            <p className="mt-4 leading-7">{post.content}</p><PostMediaGrid urls={post.image_urls} alt={`Photo attached to ${post.task_title ?? `${displayName}'s progress update`}`} className="mt-4" />
            {post.task_title && <div className="mt-4 rounded-2xl border border-line bg-surface/65 p-4"><p className="text-xs font-bold uppercase tracking-[.1em] text-muted">{post.kind.includes("completion") ? "Completed" : "Working on"}</p><h3 className="mt-1 font-bold">{post.task_title}</h3><div className="mt-3 flex flex-wrap gap-2">{post.category && <span className="badge badge-category">{post.category}</span>}{post.streak != null && <span className="badge badge-streak"><Flame size={12} /> {post.streak}-day streak</span>}</div></div>}
            <div className="mt-4 flex items-center gap-8 text-sm text-muted" aria-label="Post engagement"><span className="flex items-center gap-2"><MessageCircle size={17} /> {post.reply_count}</span><span className="flex items-center gap-2"><Heart size={17} /> {post.reaction_count}</span></div>
          </article>)}
          {!posts.length && <div className="border-b border-line p-10 text-center"><Sparkles className="mx-auto text-brand" /><h3 className="display mt-4 text-xl font-bold">No visible posts yet</h3><p className="mt-2 text-sm text-muted">Shared wins and progress updates will appear here.</p></div>}
        </section> : <section aria-label={`${displayName}'s public progress`}>
          <div className="border-b border-line px-4 py-3 text-sm text-muted"><span className="inline-flex items-center gap-2 font-bold text-community"><Globe2 size={16} /> Public task progress</span><p className="mt-1">Progress appears here only when a task is explicitly marked Public.</p></div>
          {progress.map((item) => { const updated = relativeTime(item.updated_at); return <article key={item.task_id} className="border-b border-line p-4 transition-colors hover:bg-surface/35 sm:p-5"><div className="flex items-start gap-3"><span className={`mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full ${item.status === "completed" ? "bg-success-soft text-success" : "bg-brand-soft text-brand"}`}><CheckCircle2 size={18} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">{item.task_title}</h3><span className={item.status === "completed" ? "badge bg-success-soft text-success" : "badge badge-public"}>{item.status}</span></div><p className="mt-1 text-xs text-muted">Updated {updated === "now" ? "just now" : `${updated} ago`}</p><div className="mt-3 flex flex-wrap gap-2">{item.category && <span className="badge badge-category">{item.category}</span>}</div></div></div></article>; })}
          {!progress.length && <div className="border-b border-line p-10 text-center"><Globe2 className="mx-auto text-community" /><h3 className="display mt-4 text-xl font-bold">No public tasks right now</h3><p className="mt-2 text-sm text-muted">Private task details remain invisible.</p></div>}
        </section>}
      </>}
    </div>
  </AppTabLayout>;
}
