"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CheckSquare2, LayoutList, MessageCircle, Plus, Settings, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "@/components/ui/logo";
import { Avatar } from "@/components/ui/avatar";
import { apiRequest, isPreviewMode } from "@/lib/client/api";
import type { UserProfile } from "@/types";

const nav = [
  { href: "/feed", label: "Feed", icon: LayoutList },
  { href: "/tasks", label: "Your Tasks", icon: CheckSquare2 },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/activity", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Profile", icon: UserRound },
  { href: "/settings", label: "Settings", icon: Settings },
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
      <aside className="app-sidebar fixed inset-y-0 left-0 z-30 hidden w-[88px] border-r border-line px-3 py-4 backdrop-blur lg:flex lg:flex-col xl:w-[280px] xl:px-5">
        <div className="flex justify-center xl:justify-start xl:px-3">
          <span className="xl:hidden"><Logo compact href="/feed" label="Open Feed" /></span>
          <span className="hidden xl:inline-flex"><Logo href="/feed" label="Open Feed" /></span>
        </div>
        <nav className="mt-7 space-y-1" aria-label="Primary navigation">
          {nav.map(({ href, label, icon: Icon }) => {
            const destination = label === "Profile" && username ? `/u/${username}` : href;
            const active = label === "Profile" ? pathname.startsWith("/u/") : pathname === href || (href !== "/tasks" && pathname.startsWith(href));
            return <Link key={label} href={destination} aria-current={active ? "page" : undefined} aria-label={label} className={`mx-auto flex min-h-14 w-14 items-center justify-center gap-4 rounded-full px-4 text-xl leading-6 font-semibold transition-colors xl:mx-0 xl:w-full xl:justify-start ${active ? "bg-brand-soft text-brand" : "text-muted hover:bg-canvas hover:text-ink"}`}><Icon size={24} strokeWidth={active ? 2.5 : 2} /><span className="hidden xl:inline">{label}</span></Link>;
          })}
        </nav>
        <Link href="/tasks" aria-label="Add task" className="btn btn-primary mx-auto mt-5 h-14 w-14 rounded-full p-0 shadow-sm xl:w-full xl:px-5"><Plus size={22} /><span className="hidden xl:inline">Add task</span></Link>
        <div className="mt-auto flex items-center justify-center gap-3 border-t border-line pt-4 xl:justify-start xl:px-2">
          <Avatar initials={initials} avatarUrl={isPreviewMode ? null : profile?.avatar_url} name={username ?? "Your profile"} />
          <div className="hidden min-w-0 xl:block"><p className="truncate text-sm font-bold">{username ? `@${username}` : "Your profile"}</p><p className="text-xs text-muted">{isPreviewMode ? 6 : profile?.current_streak ?? 0}-day streak</p></div>
        </div>
      </aside>
      <main id="main-content" className="min-w-0 lg:ml-[88px] xl:ml-[280px]">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-line bg-surface/95 px-1 pb-[max(.4rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur lg:hidden" aria-label="Primary navigation">
        {nav.map(({ href, label, icon: Icon }) => {
          const destination = label === "Profile" && username ? `/u/${username}` : href;
          const active = label === "Profile" ? pathname.startsWith("/u/") : pathname === href || (href !== "/tasks" && pathname.startsWith(href));
          return <Link key={label} href={destination} aria-current={active ? "page" : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-bold sm:text-xs ${active ? "text-brand" : "text-muted"}`}><Icon size={20} strokeWidth={active ? 2.6 : 2} /><span>{label}</span></Link>;
        })}
      </nav>
    </div>
  );
}
