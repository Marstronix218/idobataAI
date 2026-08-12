import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, MessageCircle, Sparkles, Volume2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { AIBadge } from "@/components/ui/status";
import { companions as previewCatalog } from "@/data/demo";
import { hasPublicSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { SocialCompanion } from "@/types";

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

export default async function CompanionProfilePage({ params }: { params: Promise<{ companionId: string }> }) {
  const slug = decodeURIComponent((await params).companionId);
  let companion: SocialCompanion | null = null;

  if (hasPublicSupabaseEnv()) {
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) notFound();
    const { data } = await (await createClient()).from("social_companions").select("*").eq("slug", slug).eq("active", true).maybeSingle();
    companion = data;
  } else {
    const preview = previewCatalog.find((item) => item.id === slug);
    if (preview) companion = {
      id: preview.id,
      slug: preview.id,
      name: preview.name,
      avatar_url: null,
      personality: preview.tagline,
      writing_style: preview.rhythm,
      interests: preview.interests,
      safety_instructions: "Encourages autonomy without guilt, romance, urgency, manipulation, or pretending to be human.",
      fallback_replies: ["A specific, pressure-free note of encouragement."],
      daily_templates: [`Today ${preview.name} is choosing one clear, manageable priority.`],
      active: true,
      posting_frequency: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  if (!companion) notFound();

  return <div className="app-page">
    {!hasPublicSupabaseEnv() && <div role="note" className="mb-5 rounded-2xl bg-sun-soft p-4 text-sm"><strong>Preview mode.</strong> This companion profile uses demo content.</div>}
    <Link href="/companions" className="btn btn-ghost px-2"><ArrowLeft size={16} /> All companions</Link>
    <section className="card mt-4 overflow-hidden"><div className="h-28 bg-community-soft paper-grid" /><div className="px-5 pb-6 sm:px-7"><div className="-mt-10 flex items-end justify-between"><Avatar initials={initials(companion.name)} ai size="lg" /><Link href="/companions" className="btn btn-secondary"><Volume2 size={16} /> Manage mute</Link></div><div className="mt-4 flex flex-wrap items-center gap-2"><h1 className="display text-3xl font-bold">{companion.name}</h1><AIBadge /></div><p className="mt-2 text-lg text-muted">{companion.personality}</p><div className="mt-5 flex flex-wrap gap-2">{companion.interests.map((interest) => <span key={interest} className="badge badge-public">{interest}</span>)}</div><p className="mt-6 leading-7">{companion.writing_style}</p><p className="mt-3 text-sm leading-6 text-muted">Plans about {companion.posting_frequency} {companion.posting_frequency === 1 ? "post" : "posts"} per day when active.</p></div></section>
    <div className="mt-5 grid gap-5 md:grid-cols-2"><section className="soft-card p-5"><Sparkles size={20} className="text-community" /><h2 className="display mt-4 text-xl font-bold">How {companion.name} encourages</h2><ul className="mt-4 space-y-3 text-sm leading-6 text-muted">{["Names the specific effort it noticed","Keeps replies concise and pressure-free",companion.safety_instructions,"Steps back from unsafe or reported content"].map((item) => <li key={item} className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-success" />{item}</li>)}</ul></section><section className="card p-5"><div className="flex items-center gap-2"><MessageCircle size={19} className="text-brand" /><h2 className="display text-xl font-bold">Example daily note</h2></div><p className="mt-5 leading-7">“{companion.daily_templates[0]}”</p><p className="mt-4 text-xs font-bold text-community">AI-generated template · always labeled when published</p></section></div>
  </div>;
}
