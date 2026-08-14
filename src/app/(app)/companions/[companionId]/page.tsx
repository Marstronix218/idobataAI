import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, CheckCircle2, Clock3, MessageCircle, Sparkles, Volume2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { AIBadge } from "@/components/ui/status";
import { companions as previewCatalog } from "@/data/demo";
import { hasPublicSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { SocialCompanion, SocialPost } from "@/types";

type CompanionPost = Pick<SocialPost, "id" | "content" | "task_title" | "category" | "created_at">;

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function postDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export default async function CompanionProfilePage({ params }: { params: Promise<{ companionId: string }> }) {
  const slug = decodeURIComponent((await params).companionId);
  let companion: SocialCompanion | null = null;
  let companionPosts: CompanionPost[] = [];

  if (hasPublicSupabaseEnv()) {
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) notFound();
    const supabase = await createClient();
    const { data } = await supabase.from("social_companions").select("*").eq("slug", slug).eq("active", true).maybeSingle();
    companion = data;
    if (companion) {
      const { data: posts } = await supabase.from("social_posts")
        .select("id, content, task_title, category, created_at")
        .eq("companion_id", companion.id).eq("kind", "ai_completion")
        .eq("visibility", "public").eq("content_status", "active")
        .lte("created_at", new Date().toISOString())
        .order("created_at", { ascending: false }).limit(12);
      companionPosts = posts ?? [];
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
      daily_templates: [
        `${preview.name} finished a focused ${preview.interests[0].toLowerCase()} task and wrote down what worked.`,
        `${preview.name} completed today's ${preview.interests[1].toLowerCase()} checkpoint without rushing the next step.`,
      ],
      active: true,
      posting_frequency: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      };
      companion = previewCompanion;
      companionPosts = previewCompanion.daily_templates.map((content, index) => ({
        id: `${preview.id}-completion-${index}`,
        content,
        task_title: `Complete today's ${preview.interests[index % preview.interests.length].toLowerCase()} task`,
        category: preview.interests[index % preview.interests.length],
        created_at: index === 0 ? "2026-08-14T18:20:00.000Z" : "2026-08-13T09:45:00.000Z",
      }));
    }
  }

  if (!companion) notFound();

  return <div className="app-page">
    {!hasPublicSupabaseEnv() && <div role="note" className="mb-5 rounded-2xl bg-sun-soft p-4 text-sm"><strong>Preview mode.</strong> This AI follower profile uses demo content.</div>}
    <Link href="/companions" className="btn btn-ghost px-2"><ArrowLeft size={16} /> All AI followers</Link>
    <section className="card mt-4 overflow-hidden"><div className="h-28 bg-community-soft paper-grid" /><div className="px-5 pb-6 sm:px-7"><div className="-mt-10 flex items-end justify-between"><Avatar initials={initials(companion.name)} avatarUrl={companion.avatar_url} ai size="lg" /><Link href="/companions" className="btn btn-secondary"><Volume2 size={16} /> Manage mute</Link></div><div className="mt-4 flex flex-wrap items-center gap-2"><h1 className="display text-3xl font-bold">{companion.name}</h1><AIBadge /></div><p className="mt-2 text-lg text-muted">{companion.personality}</p><div className="mt-5 flex flex-wrap gap-2">{companion.interests.map((interest) => <span key={interest} className="badge badge-public">{interest}</span>)}</div><p className="mt-6 leading-7">{companion.writing_style}</p><p className="mt-3 text-sm leading-6 text-muted">Plans about {companion.posting_frequency} {companion.posting_frequency === 1 ? "post" : "posts"} per day when active.</p></div></section>
    <div className="mt-5 grid gap-5 md:grid-cols-2"><section className="soft-card p-5"><Sparkles size={20} className="text-community" /><h2 className="display mt-4 text-xl font-bold">How {companion.name} may participate</h2><ul className="mt-4 space-y-3 text-sm leading-6 text-muted">{["Posts one task completion at a varied time each day","Keeps generated replies concise and pressure-free",companion.safety_instructions,"Steps back from unsafe or reported content"].map((item) => <li key={item} className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-success" />{item}</li>)}</ul></section><section className="card p-5"><div className="flex items-center gap-2"><MessageCircle size={19} className="text-brand" /><h2 className="display text-xl font-bold">Example daily note</h2></div><p className="mt-5 leading-7">“{companion.daily_templates[0]}”</p><p className="mt-4 text-xs font-bold text-community">AI-generated template · always labeled when published</p></section></div>
    <section className="mt-7" aria-labelledby="companion-posts-title">
      <div className="flex items-end justify-between gap-4"><div><p className="text-sm font-bold text-community">Daily activity</p><h2 id="companion-posts-title" className="display mt-1 text-2xl font-bold">Task completions</h2></div><span className="badge badge-public">AI-generated</span></div>
      <div className="mt-4 space-y-4">{companionPosts.map((post) => <article key={post.id} className="card p-5"><header className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-bold text-success"><CheckCircle2 size={17} /> Completed a task</span><time dateTime={post.created_at} className="flex items-center gap-1.5 text-xs font-bold text-muted"><Clock3 size={14} />{postDate(post.created_at)}</time></header><p className="mt-4 leading-7">{post.content}</p>{post.task_title && <div className="mt-4 rounded-2xl border border-line bg-surface p-4"><p className="text-xs font-bold uppercase tracking-[.1em] text-muted">Completed</p><p className="mt-1 font-bold">{post.task_title}</p><div className="mt-3 flex flex-wrap gap-2">{post.category && <span className="badge badge-category">{post.category}</span>}</div></div>}<p className="mt-3 text-xs font-bold text-community">Posted by an AI profile</p></article>)}</div>
      {!companionPosts.length && <div className="soft-card mt-4 p-8 text-center"><h3 className="display text-lg font-bold">No completions posted yet</h3><p className="mt-2 text-sm text-muted">The next daily completion will appear here after its scheduled time.</p></div>}
    </section>
  </div>;
}
