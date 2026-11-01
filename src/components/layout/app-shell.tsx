"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, BookOpen, Bot, CheckSquare2, LayoutList, MessageCircle, Plus, Settings, UserRound, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Logo } from "@/components/ui/logo";
import { Avatar } from "@/components/ui/avatar";
import { BetaBadge } from "@/components/ui/status";
import { apiRequest, isPreviewMode } from "@/lib/client/api";
import { LEGACY_FLAGS, isGateOpen, type PivotFlags, type RouteGate } from "@/lib/domain/feature-flags";
import { BetaActivityTracker } from "@/components/analytics/beta-activity-tracker";
import { SessionLengthTracker } from "@/components/analytics/session-length-tracker";
import { CONSISTENCY_DAYS_DESCRIPTION, ConsistencyDaysContext, consistencyDaysLabel, hasConsistencyDays } from "@/components/coach/consistency-days";
import { SessionNudge } from "@/components/coach/session-nudge";
import type { UserProfile } from "@/types";

// `shortLabel` is what the mobile bar renders. The full labels overflow their
// grid columns at 320px, which is the smallest phone the app has to support.
// An entry is hidden while its route gate (src/lib/flags/route-gates.ts) is closed.
const nav: Array<{ href: string; label: string; shortLabel: string; icon: LucideIcon; gate: RouteGate }> = [
  { href: "/feed", label: "Feed", shortLabel: "Feed", icon: LayoutList, gate: "wins" },
  { href: "/tasks", label: "Your Tasks", shortLabel: "Tasks", icon: CheckSquare2, gate: "always" },
  { href: "/story", label: "Story", shortLabel: "Story", icon: BookOpen, gate: "pivot_a" },
  { href: "/chat", label: "Chat", shortLabel: "Chat", icon: MessageCircle, gate: "chat" },
  { href: "/ai-personas", label: "AI Personas", shortLabel: "AI", icon: Bot, gate: "persona_chat" },
  { href: "/notifications", label: "Notifications", shortLabel: "Notifs", icon: Bell, gate: "social_feed" },
  // `/profile` resolves the signed-in username on the server and redirects to
  // `/u/{username}`; the rewrite below only skips that hop once the shell has
  // the username in hand. Profiles close with the social feed.
  { href: "/profile", label: "Profile", shortLabel: "Profile", icon: UserRound, gate: "social_feed" },
  { href: "/settings", label: "Settings", shortLabel: "Settings", icon: Settings, gate: "always" },
];

// Literal class names so Tailwind generates each one; keyed by visible entries.
const MOBILE_NAV_COLUMNS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
};

const UNREAD_POLL_MS = 60_000;

/**
 * `consistencyDays`: Pivot A only. The user's consistency days, read by the
 * (app) layout on the server, or null when unknown; shown in place of the streak.
 */
export function AppShell({ children, flags = LEGACY_FLAGS, consistencyDays = null }: { children: React.ReactNode; flags?: PivotFlags; consistencyDays?: number | null }) {
  const pathname = usePathname();
  const pivotA = flags.pivotA;
  const consistency = useMemo(() => pivotA ? { days: consistencyDays } : null, [pivotA, consistencyDays]);
  const visibleNav = nav.filter((item) => isGateOpen(flags, item.gate));
  const socialFeedOpen = isGateOpen(flags, "social_feed");
  const feedOpen = isGateOpen(flags, "wins");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (isPreviewMode) return;
    const controller = new AbortController();
    apiRequest<UserProfile>("/api/profile", { signal: controller.signal }).then(setProfile).catch(() => undefined);
    return () => controller.abort();
  }, []);

  // Encouragement a user never sees does not bring them back, so the unread
  // count refreshes on an interval, whenever the tab regains focus, after
  // navigation, and immediately when the notification screen marks items read.
  useEffect(() => {
    if (isPreviewMode || !socialFeedOpen) return;
    const controller = new AbortController();
    const refresh = () => apiRequest<{ unread: number }>("/api/notifications/unread-count", { signal: controller.signal })
      .then((result) => setUnread(result.unread))
      .catch(() => undefined);
    const syncUnread = (event: Event) => {
      const nextUnread = event instanceof CustomEvent ? event.detail?.unread : undefined;
      if (typeof nextUnread === "number") setUnread(nextUnread);
      else void refresh();
    };
    void refresh();
    const timer = setInterval(refresh, UNREAD_POLL_MS);
    window.addEventListener("focus", refresh);
    window.addEventListener("idobata:notifications-changed", syncUnread);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("idobata:notifications-changed", syncUnread);
    };
  }, [pathname, socialFeedOpen]);

  const username = isPreviewMode ? "mina" : profile?.username;
  const initials = (username ?? "You").slice(0, 2).toUpperCase();
  const unreadLabel = unread > 99 ? "99+" : String(unread);
  // The sidebar's account card falls back to Settings while profiles are closed.
  const profileHref = !socialFeedOpen ? "/settings" : username ? `/u/${username}` : "/profile";
  const homeHref = feedOpen ? "/feed" : "/tasks";
  const homeLabel = feedOpen ? "Open Feed" : "Open Your Tasks";
  return (
    <div className="app-theme min-h-screen bg-canvas text-ink">
      <BetaActivityTracker />
      <aside className="app-sidebar fixed inset-y-0 left-0 z-30 hidden w-[88px] border-r border-line px-3 py-4 backdrop-blur lg:flex lg:flex-col xl:w-[280px] xl:px-5">
        <div className="flex items-center justify-center gap-2 xl:justify-start xl:px-3">
          <span className="xl:hidden"><Logo compact href={homeHref} label={homeLabel} /></span>
          <span className="hidden xl:inline-flex"><Logo href={homeHref} label={homeLabel} /></span>
          {/* Only the wide rail has room for it. The narrow rail is icons at
              88px, where a text badge would crowd the mark it sits next to. */}
          <span className="hidden xl:inline-flex"><BetaBadge /></span>
        </div>
        <nav className="mt-7 space-y-1" aria-label="Primary navigation">
          {visibleNav.map(({ href, label, icon: Icon }) => {
            const destination = label === "Profile" ? profileHref : href;
            const active = label === "Profile" ? pathname.startsWith("/u/") || pathname === "/profile" : pathname === href || (href !== "/tasks" && pathname.startsWith(`${href}/`));
            const badged = label === "Notifications" && unread > 0;
            return <Link key={label} href={destination} aria-current={active ? "page" : undefined} aria-label={badged ? `${label}, ${unreadLabel} unread` : label} className={`mx-auto flex min-h-14 w-14 items-center justify-center gap-4 rounded-full px-4 text-xl leading-6 font-semibold transition-colors xl:mx-0 xl:w-full xl:justify-start ${active ? "bg-brand-soft text-brand" : "text-muted hover:bg-canvas hover:text-ink"}`}><span className="relative shrink-0"><Icon size={24} strokeWidth={active ? 2.5 : 2} />{badged && <span aria-hidden="true" className="absolute -right-2 -top-1.5 min-w-[1.15rem] rounded-full bg-danger px-1 text-center text-[10px] font-bold leading-[1.15rem] text-white">{unreadLabel}</span>}</span><span className="hidden xl:inline">{label}</span></Link>;
          })}
        </nav>
        <Link href="/tasks" aria-label="Add task" className="btn btn-primary mx-auto mt-5 h-14 w-14 rounded-full p-0 shadow-sm xl:w-full xl:px-5"><Plus size={22} /><span className="hidden xl:inline">Add task</span></Link>
        <Link href={profileHref} aria-label="Open your profile" className="mt-auto flex items-center justify-center gap-3 border-t border-line pt-4 transition-colors hover:bg-surface/55 xl:justify-start xl:px-2">
          <Avatar initials={initials} avatarUrl={isPreviewMode ? null : profile?.avatar_url} name={username ?? "Your profile"} />
          <div className="hidden min-w-0 xl:block"><p className="truncate text-sm font-bold">{username ? `@${username}` : "Your profile"}</p>{pivotA
            ? hasConsistencyDays(consistencyDays) && <p className="text-xs text-muted" title={`Days ${CONSISTENCY_DAYS_DESCRIPTION}`}>{consistencyDaysLabel(consistencyDays)}</p>
            : <p className="text-xs text-muted">{isPreviewMode ? 6 : profile?.current_streak ?? 0}-day streak</p>}</div>
        </Link>
      </aside>
      <main id="main-content" className="min-w-0 lg:ml-[88px] xl:ml-[280px]"><ConsistencyDaysContext value={consistency}>{children}</ConsistencyDaysContext></main>
      {pivotA && <SessionNudge />}
      {pivotA && <SessionLengthTracker />}
      <nav className={`fixed inset-x-0 bottom-0 z-40 grid ${MOBILE_NAV_COLUMNS[visibleNav.length]} border-t border-line bg-surface/95 px-1 pb-[max(.4rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur lg:hidden`} aria-label="Primary navigation">
        {visibleNav.map(({ href, label, shortLabel, icon: Icon }) => {
          const destination = label === "Profile" ? profileHref : href;
          const active = label === "Profile" ? pathname.startsWith("/u/") || pathname === "/profile" : pathname === href || (href !== "/tasks" && pathname.startsWith(`${href}/`));
          const badged = label === "Notifications" && unread > 0;
          return <Link key={label} href={destination} aria-current={active ? "page" : undefined} aria-label={badged ? `${label}, ${unreadLabel} unread` : label} className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-0.5 text-[10px] font-bold sm:text-xs ${active ? "text-brand" : "text-muted"}`}><span className="relative shrink-0"><Icon size={20} strokeWidth={active ? 2.6 : 2} />{badged && <span aria-hidden="true" className="absolute -right-2 -top-1 min-w-[1.05rem] rounded-full bg-danger px-1 text-center text-[9px] font-bold leading-[1.05rem] text-white">{unreadLabel}</span>}</span><span className="w-full truncate text-center">{shortLabel}</span></Link>;
        })}
      </nav>
    </div>
  );
}
