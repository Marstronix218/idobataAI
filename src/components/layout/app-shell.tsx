"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CheckSquare2, LayoutList, MessageCircle, Plus, Settings, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "@/components/ui/logo";
import { Avatar } from "@/components/ui/avatar";
import { apiRequest, isPreviewMode } from "@/lib/client/api";
import type { UserProfile } from "@/types";

// `shortLabel` is what the mobile bar renders. The full labels overflow their
// grid columns at 360px, which is the smallest phone the app has to support.
const nav = [
  { href: "/feed", label: "Feed", shortLabel: "Feed", icon: LayoutList },
  { href: "/tasks", label: "Your Tasks", shortLabel: "Tasks", icon: CheckSquare2 },
  { href: "/chat", label: "Chat", shortLabel: "Chat", icon: MessageCircle },
  { href: "/activity", label: "Notifications", shortLabel: "Alerts", icon: Bell },
  { href: "/settings", label: "Profile", shortLabel: "Profile", icon: UserRound },
  { href: "/settings", label: "Settings", shortLabel: "Settings", icon: Settings },
];

const UNREAD_POLL_MS = 60_000;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (isPreviewMode) return;
    const controller = new AbortController();
    apiRequest<UserProfile>("/api/profile", { signal: controller.signal }).then(setProfile).catch(() => undefined);
    return () => controller.abort();
  }, []);

  // Encouragement a user never sees does not bring them back, so the unread
  // count refreshes on an interval, whenever the tab regains focus, and after
  // each navigation (which is how /activity clears the badge).
  useEffect(() => {
    if (isPreviewMode) return;
    const controller = new AbortController();
    const refresh = () => apiRequest<{ unread: number }>("/api/notifications/unread-count", { signal: controller.signal })
      .then((result) => setUnread(result.unread))
      .catch(() => undefined);
    void refresh();
    const timer = setInterval(refresh, UNREAD_POLL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [pathname]);

  const username = isPreviewMode ? "mina" : profile?.username;
  const initials = (username ?? "You").slice(0, 2).toUpperCase();
  const unreadLabel = unread > 99 ? "99+" : String(unread);
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
            const badged = label === "Notifications" && unread > 0;
            return <Link key={label} href={destination} aria-current={active ? "page" : undefined} aria-label={badged ? `${label}, ${unreadLabel} unread` : label} className={`mx-auto flex min-h-14 w-14 items-center justify-center gap-4 rounded-full px-4 text-xl leading-6 font-semibold transition-colors xl:mx-0 xl:w-full xl:justify-start ${active ? "bg-brand-soft text-brand" : "text-muted hover:bg-canvas hover:text-ink"}`}><span className="relative shrink-0"><Icon size={24} strokeWidth={active ? 2.5 : 2} />{badged && <span aria-hidden="true" className="absolute -right-2 -top-1.5 min-w-[1.15rem] rounded-full bg-danger px-1 text-center text-[10px] font-bold leading-[1.15rem] text-white">{unreadLabel}</span>}</span><span className="hidden xl:inline">{label}</span></Link>;
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
        {nav.map(({ href, label, shortLabel, icon: Icon }) => {
          const destination = label === "Profile" && username ? `/u/${username}` : href;
          const active = label === "Profile" ? pathname.startsWith("/u/") : pathname === href || (href !== "/tasks" && pathname.startsWith(href));
          const badged = label === "Notifications" && unread > 0;
          return <Link key={label} href={destination} aria-current={active ? "page" : undefined} aria-label={badged ? `${label}, ${unreadLabel} unread` : label} className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-0.5 text-[10px] font-bold sm:text-xs ${active ? "text-brand" : "text-muted"}`}><span className="relative shrink-0"><Icon size={20} strokeWidth={active ? 2.6 : 2} />{badged && <span aria-hidden="true" className="absolute -right-2 -top-1 min-w-[1.05rem] rounded-full bg-danger px-1 text-center text-[9px] font-bold leading-[1.05rem] text-white">{unreadLabel}</span>}</span><span className="w-full truncate text-center">{shortLabel}</span></Link>;
        })}
      </nav>
    </div>
  );
}
