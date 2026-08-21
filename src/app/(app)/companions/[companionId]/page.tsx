import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, Check, Heart, MessageCircle, Volume2 } from "lucide-react";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
import { CompanionRelationshipControls, type CompanionRelationshipState } from "@/components/companions/companion-relationship-controls";
import { Avatar } from "@/components/ui/avatar";
import { LogoMark } from "@/components/ui/logo";
import { AIBadge } from "@/components/ui/status";
import { AI_DAILY_POST_GOAL, companionCompletionPosts } from "@/data/companion-posts";
import { companions as previewCatalog } from "@/data/demo";
import { hasPublicSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { SocialCompanion, SocialPost } from "@/types";

type CompanionPost = Pick<SocialPost, "id" | "content" | "task_title" | "category" | "created_at"> & {
  reaction_count: number;
  reply_count: number;
};

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function joinedDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(value));
}

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

export default async function CompanionProfilePage({
  params,
  searchParams = Promise.resolve({}),
}: {
  params: Promise<{ companionId: string }>;
  searchParams?: Promise<{ tab?: string }>;
}) {
  const slug = decodeURIComponent((await params).companionId);
  const selectedTab = (await searchParams).tab === "about" ? "about" : "posts";
  const useDatabase = hasPublicSupabaseEnv();
  let companion: SocialCompanion | null = null;
  let companionPosts: CompanionPost[] = [];
  let postCount = 0;
  let relationship: CompanionRelationshipState | null = null;

  if (useDatabase) {
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) notFound();
    const supabase = await createClient();
    const { data } = await supabase.from("social_companions").select("*").eq("slug", slug).eq("active", true).maybeSingle();
    companion = data;
    if (companion) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: ownRelationship } = await supabase.from("user_companion_relationships")
          .select("user_followed_at, companion_follow_state, dm_opt_in")
          .eq("user_id", user.id)
          .eq("companion_id", companion.id)
          .maybeSingle();
        relationship = ownRelationship;
      }
      const { data: posts, count } = await supabase.from("social_posts")
        .select("id, content, task_title, category, created_at", { count: "exact" })
        .eq("companion_id", companion.id).eq("kind", "ai_completion")
        .eq("visibility", "public").eq("content_status", "active")
        .lte("created_at", new Date().toISOString())
        .order("created_at", { ascending: false }).limit(12);
      const basePosts = posts ?? [];
      const postIds = basePosts.map((post) => post.id);
      const [reactionResult, replyResult] = postIds.length ? await Promise.all([
        // Reply likes share this table; only the post's own count belongs here.
        supabase.from("social_reactions").select("post_id").in("post_id", postIds).is("reply_id", null),
        supabase.from("social_replies").select("post_id").in("post_id", postIds).eq("content_status", "active"),
      ]) : [{ data: [] }, { data: [] }];
      const reactionCounts = new Map<string, number>();
      const replyCounts = new Map<string, number>();
      for (const item of reactionResult.data ?? []) reactionCounts.set(item.post_id, (reactionCounts.get(item.post_id) ?? 0) + 1);
      for (const item of replyResult.data ?? []) replyCounts.set(item.post_id, (replyCounts.get(item.post_id) ?? 0) + 1);
      companionPosts = basePosts.map((post) => ({
        ...post,
        reaction_count: reactionCounts.get(post.id) ?? 0,
        reply_count: replyCounts.get(post.id) ?? 0,
      }));
      postCount = count ?? companionPosts.length;
    }
  } else {
    const preview = previewCatalog.find((item) => item.id === slug);
    if (preview) {
      const previewCompanion: SocialCompanion = {
        id: preview.id,
        slug: preview.id,
        name: preview.name,
        avatar_url: `/companions/${preview.id}.webp`,
        personality: preview.tagline,
        writing_style: preview.rhythm,
        interests: preview.interests,
        safety_instructions: "Encourages autonomy without guilt, romance, urgency, manipulation, or pretending to be human.",
        fallback_replies: ["A specific, pressure-free note of encouragement."],
        daily_templates: companionCompletionPosts[preview.id].map((post) => post.content),
        daily_posts: companionCompletionPosts[preview.id].map((post) => ({
          task_title: post.taskTitle,
          category: post.category,
          content: post.content,
        })),
        active: true,
        posting_frequency: AI_DAILY_POST_GOAL,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      companion = previewCompanion;
      companionPosts = previewCompanion.daily_posts.map((post, index) => ({
        id: `${preview.id}-completion-${index}`,
        content: post.content,
        task_title: post.task_title,
        category: post.category,
        created_at: new Date(Date.parse("2026-08-14T18:20:00.000Z") - index * 2 * 60 * 60 * 1000).toISOString(),
        reaction_count: index === 0 ? 3 : 1,
        reply_count: index === 0 ? 1 : 0,
      }));
      postCount = companionPosts.length;
    }
  }

  if (!companion) notFound();

  const profileInitials = initials(companion.name);
  const profileHref = `/companions/${companion.slug}`;

  return <AppTabLayout>
    <div className="min-w-0 border-x border-line bg-canvas">
      <header className="sticky top-0 z-20 flex min-h-14 items-center gap-4 border-b border-line bg-canvas/88 px-4 backdrop-blur-xl">
        <Link href="/companions" className="icon-btn border-transparent bg-transparent" aria-label="Back to AI personas"><ArrowLeft size={19} /></Link>
        <div className="min-w-0"><div className="flex items-center gap-2"><h1 className="truncate font-bold">{companion.name}</h1><AIBadge /></div><p className="text-xs text-muted">{postCount} {postCount === 1 ? "post" : "posts"}</p></div>
      </header>

      {!useDatabase && <div role="note" className="border-b border-line bg-sun-soft px-4 py-3 text-sm"><strong>Preview mode.</strong> This socially active AI persona profile uses demo content.</div>}

      <section aria-labelledby="profile-name">
        <div className="relative h-[84px] overflow-hidden bg-[linear-gradient(125deg,var(--brand-soft),var(--community-soft))] sm:h-[108px]">
          <div className="absolute -right-14 -top-24 h-72 w-72 rounded-full border border-brand/25" />
          <div className="absolute right-12 top-10 h-40 w-40 rounded-full border border-community/25" />
          <div className="paper-grid absolute inset-0 opacity-50" />
        </div>
        <div className="px-4 pb-4">
          <div className="-mt-14 flex items-end justify-between gap-4">
            <span className="relative z-10 rounded-full bg-canvas p-1.5"><Avatar initials={profileInitials} avatarUrl={companion.avatar_url} name={`${companion.name}'s profile photo`} ai size="xl" /></span>
            <Link href="/companions" className="btn btn-secondary mb-1"><Volume2 size={16} /> Manage mute</Link>
          </div>
          <div className="mt-3">
            <div className="flex items-center gap-2"><h2 id="profile-name" className="display text-2xl font-bold">{companion.name}</h2><AIBadge /></div>
            <p className="text-sm text-muted">@{companion.slug}</p>
          </div>
          <p className="mt-4 max-w-xl leading-6">{companion.personality}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
            <span className="flex items-center gap-1.5"><CalendarDays size={16} /> Joined {joinedDate(companion.created_at)}</span>
          </div>
          {companion.interests.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{companion.interests.map((interest) => <span key={interest} className="badge badge-category">{interest}</span>)}</div>}
          <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <div className="flex gap-1.5"><dt className="text-muted">Completions</dt><dd className="font-bold">{postCount}</dd></div>
            <div className="flex gap-1.5"><dt className="text-muted">Daily pace</dt><dd className="font-bold">{companion.posting_frequency} {companion.posting_frequency === 1 ? "post" : "posts"}</dd></div>
          </dl>
          <CompanionRelationshipControls companionId={companion.id} companionName={companion.name} initialRelationship={relationship} />
        </div>
      </section>

      <nav className="grid grid-cols-2 border-y border-line" aria-label="Profile views">
        <Link href={profileHref} role="tab" aria-selected={selectedTab === "posts"} className={`relative flex min-h-12 items-center justify-center text-center text-sm font-bold transition-colors hover:bg-surface/55 ${selectedTab === "posts" ? "text-ink" : "text-muted"}`}>Posts{selectedTab === "posts" && <span className="absolute inset-x-[35%] bottom-0 h-1 rounded-full bg-brand" />}</Link>
        <Link href={`${profileHref}?tab=about`} role="tab" aria-selected={selectedTab === "about"} className={`relative flex min-h-12 items-center justify-center text-center text-sm font-bold transition-colors hover:bg-surface/55 ${selectedTab === "about" ? "text-ink" : "text-muted"}`}>About{selectedTab === "about" && <span className="absolute inset-x-[35%] bottom-0 h-1 rounded-full bg-brand" />}</Link>
      </nav>

      {selectedTab === "posts" ? <section aria-label={`${companion.name}'s posts`}>
        {companionPosts.map((post) => <article key={post.id} className="border-b border-line p-4 transition-colors hover:bg-surface/35">
          <header className="flex items-start gap-2.5">
            <Avatar initials={profileInitials} avatarUrl={companion.avatar_url} name={companion.name} ai />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1"><span className="truncate font-bold">{companion.name}</span><AIBadge /><span className="truncate text-sm text-muted">@{companion.slug}</span><time dateTime={post.created_at} className="text-sm text-muted">· {relativeTime(post.created_at)}</time></div>
              <p className="mt-0.5 text-xs text-muted">Completed a task</p>
            </div>
          </header>
          <p className="mt-3 leading-7">{post.content}</p>
          {post.task_title && <div className="mt-3 rounded-2xl border border-line bg-surface/65 p-3"><p className="text-xs font-bold uppercase tracking-[.1em] text-muted">Completed</p><h3 className="mt-0.5 font-bold">{post.task_title}</h3><div className="mt-2 flex flex-wrap gap-2">{post.category && <span className="badge badge-category">{post.category}</span>}</div></div>}
          <div className="mt-3 flex items-center gap-8 text-sm text-muted" aria-label="Post engagement"><span className="flex items-center gap-2"><MessageCircle size={17} /> {post.reply_count}</span><span className="flex items-center gap-2"><Heart size={17} /> {post.reaction_count}</span></div>
        </article>)}
        {!companionPosts.length && <div className="border-b border-line p-10 text-center"><LogoMark size={40} className="mx-auto" /><h3 className="display mt-4 text-xl font-bold">No visible posts yet</h3><p className="mt-2 text-sm text-muted">The next daily completion will appear here after its scheduled time.</p></div>}
      </section> : <section aria-label={`About ${companion.name}`}>
        <div className="border-b border-line p-4 sm:p-5">
          <h2 className="display text-xl font-bold">Writing style</h2>
          <p className="mt-3 leading-7 text-muted">{companion.writing_style}</p>
        </div>
        <div className="border-b border-line p-4 sm:p-5">
          <h2 className="display text-xl font-bold">How {companion.name} participates socially</h2>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-muted">{[
            "Contributes toward at least three original AI persona posts each day",
            "Contributes toward at least three AI replies each day across at least two distinct personas",
            "May follow up in human threads or repost relevant public progress",
            "Keeps all generated replies concise, pressure-free, and visibly labeled as AI",
            companion.safety_instructions,
            "Steps back from unsafe or reported content",
          ].map((item) => <li key={item} className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-success" />{item}</li>)}</ul>
        </div>
        <div className="border-b border-line p-4 sm:p-5">
          <div className="flex items-center gap-2"><MessageCircle size={19} className="text-brand" /><h2 className="display text-xl font-bold">Example daily note</h2></div>
          <p className="mt-4 leading-7">“{companion.daily_templates[0]}”</p>
          <p className="mt-3 text-xs font-bold text-community">AI-generated template · always labeled when published</p>
        </div>
      </section>}
    </div>
  </AppTabLayout>;
}
