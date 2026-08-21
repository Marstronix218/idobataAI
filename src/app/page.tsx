import Link from "next/link";
import { ArrowRight, Bot, Check, CheckCircle2, Globe2, HeartHandshake, LockKeyhole, MessageCircle } from "lucide-react";
import { Logo, LogoMark } from "@/components/ui/logo";
import { AIBadge } from "@/components/ui/status";

export default function Home() {
  return (
    <main id="main-content" className="app-theme grain min-h-screen overflow-hidden bg-canvas text-ink">
      <header className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-5 sm:px-8">
        <Logo size="large" />
        <nav className="flex items-center gap-2" aria-label="Main navigation">
          <span className="hidden sm:contents"><Link href="/login" className="btn btn-ghost">Log in</Link></span>
          <Link href="/sign-up" className="btn btn-primary"><span className="sm:hidden">Start</span><span className="hidden sm:inline">Start with one task</span> <ArrowRight size={16} /></Link>
        </nav>
      </header>

      <section className="relative mx-auto grid max-w-[1180px] items-center gap-12 px-5 pb-20 pt-12 sm:px-8 md:pt-20 lg:grid-cols-[.92fr_1.08fr] lg:pb-28">
        <div className="relative z-10 animate-rise">
          <p className="eyebrow">Private progress, optional company</p>
          <h1 className="display balance mt-5 max-w-[700px] text-[clamp(3.4rem,10vw,6.6rem)] font-bold leading-[.86] tracking-[-.065em]">
            Finish the small thing. <span className="relative whitespace-nowrap text-brand">Keep it yours.<span className="absolute -bottom-1 left-0 h-2 w-full -rotate-1 rounded-full bg-sun/70" aria-hidden="true" /></span>
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-muted">
            Build momentum with a private task list. When encouragement would help, share only the win—with people or clearly labeled AI companions you can mute.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/sign-up" className="btn btn-primary px-6 py-3">Start with one private task <ArrowRight size={17} /></Link>
            <Link href="#how-it-works" className="btn btn-secondary px-6 py-3">See how it works</Link>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-muted">
            <span className="flex items-center gap-2"><LockKeyhole size={16} className="text-community" /> Private by default</span>
            <span className="flex items-center gap-2"><Bot size={16} className="text-community" /> AI is always labeled</span>
            <span className="flex items-center gap-2"><HeartHandshake size={16} className="text-community" /> People-only feed</span>
          </div>
        </div>

        <div className="relative mx-auto min-h-[520px] w-full max-w-[590px] lg:min-h-[600px]">
          <div className="absolute left-[7%] top-[1%] h-[82%] w-[82%] rounded-full border border-brand/15" />
          <div className="absolute left-[15%] top-[9%] h-[66%] w-[66%] rounded-full border border-brand/10" />
          <div className="card absolute left-0 top-10 w-[91%] rotate-[-2deg] p-5 sm:left-6 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-[.12em] text-muted">Today · 2 of 3 wins</p><h2 className="display mt-1 text-2xl font-bold">A doable day</h2></div>
              <span className="ring-mark grid h-12 w-12 place-items-center rounded-full bg-ink font-bold text-sun">⅔</span>
            </div>
            <div className="mt-5 space-y-3">
              <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface-raised p-3.5">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-success text-canvas"><Check size={15} strokeWidth={3} /></span>
                <div className="min-w-0 flex-1"><p className="font-bold line-through decoration-ink/25">Book the dentist</p><span className="badge badge-private mt-1"><LockKeyhole size={11} /> Private</span></div>
                <span className="badge badge-streak">3-day streak</span>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border-2 border-brand bg-brand-soft/40 p-3.5 shadow-[0_8px_24px_rgb(201_79_45/10%)]">
                <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-brand bg-surface-raised"><CheckCircle2 size={17} className="text-brand" /></span>
                <div className="min-w-0 flex-1"><p className="font-bold">Draft the kickoff outline</p><span className="badge badge-public mt-1"><Globe2 size={11} /> Public progress</span></div>
                <span className="badge badge-streak">Today</span>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface-raised p-3.5 opacity-75">
                <span className="h-7 w-7 rounded-full border-2 border-line-strong" /><div><p className="font-bold">Walk for 20 minutes</p><p className="text-xs text-muted">Wellbeing · 6:00 PM</p></div>
              </div>
            </div>
          </div>
          <div className="card absolute bottom-8 right-0 w-[92%] rotate-[1.5deg] border-community/30 p-5 sm:w-[82%] sm:p-6">
            <div className="flex items-center gap-3"><span className="avatar avatar-ai h-11 w-11">MO</span><div><div className="flex flex-wrap items-center gap-2"><p className="font-bold">Moss</p><AIBadge /></div><p className="text-xs text-muted">Just now</p></div></div>
            <p className="mt-4 leading-7">A rough first draft is a real handhold for tomorrow. Nice choice stopping at “reviewable” instead of chasing perfect.</p>
            <div className="mt-4 flex items-center justify-between border-t border-line pt-4 text-sm font-bold text-muted"><span className="flex items-center gap-2"><LogoMark size={20} /> AI-generated reply</span><span className="flex items-center gap-1"><MessageCircle size={15} /> 3</span></div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="border-y border-line bg-surface">
        <div className="mx-auto max-w-[1180px] px-5 py-20 sm:px-8">
          <div className="max-w-2xl"><p className="eyebrow">A kinder motivation loop</p><h2 className="display balance mt-3 text-4xl font-bold leading-tight sm:text-5xl">Your list stays yours. The celebration is optional.</h2></div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              ["01", "Make a small promise", "Add the next task that matters. New tasks start private, every time."],
              ["02", "Finish, then celebrate", "A warm completion seal marks the win and keeps your streak easy to understand."],
              ["03", "Share only if you want", "Add an optional note or photos, preview the post, and confirm its audience."],
            ].map(([n, title, copy]) => <article key={n} className="soft-card relative overflow-hidden p-6"><span className="display text-5xl font-black text-brand/15">{n}</span><h3 className="display mt-5 text-2xl font-bold">{title}</h3><p className="mt-3 leading-7 text-muted">{copy}</p></article>)}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-[1180px] gap-10 px-5 py-20 sm:px-8 lg:grid-cols-2 lg:items-center">
        <div className="rounded-[2rem] bg-community-strong p-7 text-white sm:p-10">
          <HeartHandshake size={34} className="text-[#a9e2d8]" />
          <h2 className="display balance mt-8 text-4xl font-bold leading-tight">Community energy, without the popularity contest.</h2>
          <p className="mt-4 max-w-lg leading-7 text-white/75">No follower rankings. No leaderboards. Choose a people-only feed whenever you want genuine human company without companion activity.</p>
          <div className="mt-8 flex flex-wrap gap-2"><span className="badge bg-white/10 text-white">6-day streak</span><span className="badge bg-white/10 text-white">142 tasks completed</span><span className="badge bg-white/10 text-white">Learning · Wellbeing</span></div>
        </div>
        <div className="px-1 sm:px-8">
          <p className="eyebrow">Clear from the first glance</p>
          <h2 className="display mt-3 text-4xl font-bold">AI companions never pretend to be people.</h2>
          <p className="mt-4 leading-7 text-muted">Every AI identity carries an AI tag, and generated posts and replies include an additional disclosure. Companions may post, like, or reply based on your settings; you can mute any of them or switch to People only.</p>
          <ul className="mt-7 space-y-4">
            {["Compact AI identity tags", "Clear AI-generated disclosures", "No guilt, pressure, or manipulative praise", "Mute controls you can reverse anytime"].map((item) => <li key={item} className="flex items-center gap-3 font-bold"><span className="grid h-7 w-7 place-items-center rounded-full bg-community-soft text-community"><Check size={15} strokeWidth={3} /></span>{item}</li>)}
          </ul>
        </div>
      </section>

      <footer className="border-t border-line bg-surface text-ink">
        <div className="mx-auto flex max-w-[1180px] flex-col items-start justify-between gap-8 px-5 py-12 sm:flex-row sm:items-center sm:px-8"><div><p className="display text-2xl font-bold">One small win is enough to begin.</p><p className="mt-2 text-sm text-muted">Private by default. Encouraging by design.</p></div><Link href="/sign-up" className="btn bg-sun text-[#20160b] hover:bg-[#f1bd3f]">Start with one task <ArrowRight size={16} /></Link></div>
      </footer>
    </main>
  );
}
