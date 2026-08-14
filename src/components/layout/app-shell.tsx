"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Bot, CheckSquare2, Flame, LayoutList, Plus, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "@/components/ui/logo";
import { Avatar } from "@/components/ui/avatar";
import { apiRequest, isPreviewMode } from "@/lib/client/api";
import type { UserProfile } from "@/types";

const nav = [
  { href: "/tasks", label: "Tasks", icon: CheckSquare2 },
  { href: "/feed", label: "Feed", icon: LayoutList },
  { href: "/activity", label: "Activity", icon: Bell },
  { href: "/companions", label: "Companions", icon: Bot },
  { href: "/settings", label: "You", icon: UserRound },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  useEffect(() => {
    if (isPreviewMode) return;
    const controller = new AbortController();
    apiRequest<UserProfile>("/api/profile", { signal: controller.signal }).then(setProfile).catch(() => undefined);
    return () => controller.abort();
  }, []);
  const username = isPreviewMode ? "mina" : profile?.username;
  const initials = (username ?? "You").slice(0, 2).toUpperCase();
  return (
    <div className="app-theme min-h-screen bg-canvas text-ink">
      <aside className="app-sidebar fixed inset-y-0 left-0 z-30 hidden w-[232px] border-r border-line px-5 py-6 backdrop-blur lg:flex lg:flex-col">
        <Logo />
        <nav className="mt-10 space-y-1" aria-label="Primary navigation">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== "/tasks" && pathname.startsWith(href));
            return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-bold transition-colors ${active ? "bg-brand-soft text-brand" : "text-muted hover:bg-canvas hover:text-ink"}`}><Icon size={19} />{label}</Link>;
          })}
        </nav>
        <div className="goal-card mt-6 rounded-2xl p-4">
          <div className="flex items-center justify-between text-xs font-bold text-muted"><span>Today’s goal</span><Flame size={15} className="text-sun" /></div>
          <p className="display mt-2 text-2xl font-bold">{isPreviewMode ? 2 : profile?.daily_goal ?? "—"} <span className="text-sm text-muted">{isPreviewMode ? "of 3 wins" : "wins planned"}</span></p>
          {isPreviewMode && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full w-2/3 rounded-full bg-sun" /></div>}
        </div>
        <Link href="/tasks" className="btn btn-primary mt-4"><Plus size={17} /> Add task</Link>
        <div className="mt-auto flex items-center gap-3 border-t border-line pt-5">
          <Avatar initials={initials} avatarUrl={isPreviewMode ? null : profile?.avatar_url} name={username ?? "Your profile"} />
          <div><p className="text-sm font-bold">{username ? `@${username}` : "Your profile"}</p><p className="text-xs text-muted">{isPreviewMode ? 6 : profile?.current_streak ?? 0}-day streak</p></div>
        </div>
      </aside>
      <main id="main-content" className="min-w-0 lg:ml-[232px]">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-surface/95 px-1 pb-[max(.4rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur lg:hidden" aria-label="Primary navigation">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== "/tasks" && pathname.startsWith(href));
          return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[.66rem] font-bold ${active ? "text-brand" : "text-muted"}`}><Icon size={20} strokeWidth={active ? 2.6 : 2} /><span>{label}</span></Link>;
        })}
      </nav>
    </div>
  );
}
