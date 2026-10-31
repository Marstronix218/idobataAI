import { render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { resolveFlags } from "@/lib/domain/feature-flags";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/tasks" }));

import { AppShell } from "@/components/layout/app-shell";

// The sidebar and the bottom bar share one label because CSS shows exactly one
// of them at any breakpoint; jsdom loads no CSS, so axe sees both at once.
const axeOptions = { rules: { "landmark-unique": { enabled: false } } };

function navigations() {
  return screen.getAllByRole("navigation", { name: "Primary navigation" });
}

function linkNames(navigation: HTMLElement) {
  return within(navigation).getAllByRole("link").map((link) => link.getAttribute("aria-label"));
}

describe("AppShell navigation under the Pivot A flags", () => {
  it("shows the people-only Wins feed, tasks and settings under a default Pivot A", async () => {
    const { container } = render(<AppShell flags={resolveFlags({ "pivot_a.enabled": true })}><p>Tasks</p></AppShell>);

    for (const navigation of navigations()) {
      // Profiles live under /u/, which closes with the social feed.
      expect(linkNames(navigation)).toEqual(["Feed", "Your Tasks", "Settings"]);
    }
    expect(screen.getByRole("link", { name: "Open your profile" })).toHaveAttribute("href", "/settings");
    expect(screen.getAllByRole("link", { name: "Open Feed" })).toHaveLength(2);
    expect(navigations()[1]).toHaveClass("grid-cols-3");
    expect(navigations()[1]).not.toHaveClass("grid-cols-7");
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });

  it("drops the feed and points the logo at tasks when sharing is off too", async () => {
    const { container } = render(<AppShell flags={resolveFlags({ "pivot_a.enabled": true, "share_win.enabled": false })}><p>Tasks</p></AppShell>);

    for (const navigation of navigations()) {
      expect(linkNames(navigation)).toEqual(["Your Tasks", "Settings"]);
    }
    expect(screen.queryByRole("link", { name: "Open Feed" })).not.toBeInTheDocument();
    for (const logo of screen.getAllByRole("link", { name: "Open Your Tasks" })) {
      expect(logo).toHaveAttribute("href", "/tasks");
    }
    expect(navigations()[1]).toHaveClass("grid-cols-2");
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });

  it("keeps human chat and notifications but never AI Personas when the social feed is switched on under Pivot A", () => {
    render(<AppShell flags={resolveFlags({ "pivot_a.enabled": true, "social_feed.enabled": true })}><p>Tasks</p></AppShell>);

    for (const navigation of navigations()) {
      expect(linkNames(navigation)).toEqual(["Feed", "Your Tasks", "Chat", "Notifications", "Profile", "Settings"]);
      expect(within(navigation).getByRole("link", { name: "Profile" })).toHaveAttribute("href", "/u/mina");
    }
    expect(navigations()[1]).toHaveClass("grid-cols-6");
  });

  it("shows every entry with today's flags", () => {
    render(<AppShell flags={resolveFlags({})}><p>Tasks</p></AppShell>);

    for (const navigation of navigations()) {
      expect(linkNames(navigation)).toEqual(["Feed", "Your Tasks", "Chat", "AI Personas", "Notifications", "Profile", "Settings"]);
    }
    expect(navigations()[1]).toHaveClass("grid-cols-7");
  });
});
