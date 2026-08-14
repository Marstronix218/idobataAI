import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Flame, Globe2, Pencil, Sparkles, Trophy } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { PrivacyBadge } from "@/components/ui/status";
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

const previewProfile: UserProfile = {
  id: "preview-user",
  username: "mina",
  avatar_url: null,
  daily_goal: 3,
  interests: ["Work", "Learning", "Wellbeing"],
  default_task_visibility: "private",
  xp: 2840,
  current_streak: 6,
  last_completion_date: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const previewPosts: SocialPost[] = [{
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
  is_ai_generated: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const requestedUsername = decodeURIComponent((await params).username);
  let profile = previewProfile;
  let posts = previewPosts;
  let progress: PublicProgress[] = [];
  let completionCount = previewPosts.length;
  let isOwner = true;

  if (hasPublicSupabaseEnv()) {
    if (!/^[A-Za-z0-9_]{3,24}$/.test(requestedUsername)) notFound();
    const supabase = await createClient();
    const [{ data: viewer }, { data: foundProfile }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("user_profiles").select("*").ilike("username", requestedUsername).maybeSingle(),
    ]);
    if (!foundProfile) notFound();
    profile = foundProfile;
    isOwner = viewer.user?.id === profile.id;
    const [postResult, countResult, progressResult] = await Promise.all([
      supabase.from("social_posts").select("*").eq("author_id", profile.id).eq("content_status", "active").order("created_at", { ascending: false }).limit(10),
      supabase.from("social_posts").select("id", { count: "exact", head: true }).eq("author_id", profile.id).eq("kind", "human_completion").eq("content_status", "active"),
      supabase.from("public_task_progress").select("task_id, task_title, category, status, xp_value, updated_at").eq("owner_id", profile.id).order("updated_at", { ascending: false }).limit(10),
    ]);
    posts = postResult.data ?? [];
    completionCount = countResult.count ?? 0;
    progress = (progressResult.data ?? []) as PublicProgress[];
  } else if (requestedUsername.toLowerCase() !== "mina") {
    notFound();
  }

  const sharedWins = posts.filter((post) => post.visibility === "public" && post.kind === "human_completion").length;
  const initials = profile.username.slice(0, 2).toUpperCase();

  return <div className="app-page max-w-[900px]">
    {!hasPublicSupabaseEnv() && <div role="note" className="mb-5 rounded-2xl bg-sun-soft p-4 text-sm"><strong>Preview mode.</strong> This profile uses demo accomplishments.</div>}
    <section className="card overflow-hidden"><div className="relative h-36 overflow-hidden bg-brand-soft paper-grid"><div className="absolute -right-10 -top-20 h-64 w-64 rounded-full border border-brand/20" /><div className="absolute -right-1 -top-10 h-44 w-44 rounded-full border border-brand/15" /></div><div className="px-5 pb-6 sm:px-7"><div className="-mt-10 flex items-end justify-between"><Avatar initials={initials} avatarUrl={profile.avatar_url} name={profile.username} size="lg" />{isOwner && <Link href="/settings#profile" className="btn btn-secondary"><Pencil size={16} /> Edit profile</Link>}</div><div className="mt-4"><h1 className="display text-3xl font-bold">@{profile.username}</h1><p className="mt-1 text-sm font-bold text-muted">Progress shared on the user’s terms.</p></div><div className="mt-5 flex flex-wrap gap-2">{profile.interests.map((interest, index) => <span key={interest} className={index % 2 ? "badge badge-public" : "badge badge-category"}>{interest}</span>)}</div></div></section>
    <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Progress summary">{[[CheckCircle2,String(completionCount),"shared completions"],[Flame,`${profile.current_streak} days`,"current streak"],[Sparkles,profile.xp.toLocaleString(),"total XP"],[Trophy,String(sharedWins),"recent shared wins"]].map(([Icon,value,label]) => { const Comp = Icon as typeof CheckCircle2; return <div key={label as string} className="soft-card p-4"><Comp size={18} className="text-brand" /><p className="display mt-4 text-2xl font-bold">{value as string}</p><p className="mt-1 text-xs font-bold text-muted">{label as string}</p></div>; })}</section>
    <h2 className="display mt-7 text-2xl font-bold">Recent accomplishments</h2>
    <section className="mt-4 space-y-4">{posts.map((post) => <article key={post.id} className="card p-5"><header className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-full bg-success-soft text-success"><CheckCircle2 size={18} /></span><div><p className="text-xs font-bold uppercase tracking-[.1em] text-muted">{post.kind.includes("completion") ? "Completed a task" : "Progress update"}</p><p className="text-xs text-muted">{formatDate(post.created_at)}</p></div></div>{isOwner && <PrivacyBadge isPublic={post.visibility === "public"} />}</header>{post.task_title && <h3 className="display mt-5 text-xl font-bold">{post.task_title}</h3>}<p className="mt-3 leading-7 text-muted">{post.content}</p><div className="mt-4 flex flex-wrap gap-2">{post.category && <span className="badge badge-category">{post.category}</span>}{post.xp_earned != null && <span className="badge badge-xp">+{post.xp_earned} XP</span>}</div></article>)}{!posts.length && <div className="soft-card p-8 text-center text-muted">No visible accomplishments yet.</div>}</section>
    <h2 className="display mt-7 text-2xl font-bold">Public progress</h2>
    <section className="mt-4 grid gap-3 sm:grid-cols-2">{progress.map((item) => <article key={item.task_id} className="soft-card p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-bold">{item.task_title}</h3><span className={item.status === "completed" ? "badge bg-success-soft text-success" : "badge badge-public"}>{item.status}</span></div><div className="mt-3 flex flex-wrap gap-2">{item.category && <span className="badge badge-category">{item.category}</span>}{item.xp_value != null && <span className="badge badge-xp">{item.xp_value} XP</span>}</div></article>)}{!progress.length && <div className="soft-card p-6 text-sm text-muted sm:col-span-2">No public tasks right now.</div>}</section>
    <aside className="soft-card mt-5 flex items-start gap-3 p-4"><Globe2 size={18} className="mt-0.5 text-community" /><div><p className="text-sm font-bold">Only visible progress appears here.</p><p className="mt-1 text-sm leading-6 text-muted">Private tasks and other people’s private posts remain inaccessible.</p></div></aside>
  </div>;
}
