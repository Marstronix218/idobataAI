import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigationState = vi.hoisted(() => ({ pathname: "/feed" }));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
}));

import { AppShell } from "@/components/layout/app-shell";

afterEach(() => {
  navigationState.pathname = "/feed";
});

describe("AppShell", () => {
  it("presents AI Personas plus distinct Profile and Settings tabs on desktop and mobile", () => {
    render(<AppShell><p>Community timeline</p></AppShell>);

    for (const navigation of screen.getAllByRole("navigation", { name: "Primary navigation" })) {
      const links = within(navigation).getAllByRole("link");
      expect(links).toHaveLength(7);
      expect(links[0]).toHaveAttribute("href", "/feed");
      expect(links[0]).toHaveAttribute("aria-current", "page");
      expect(links[1]).toHaveAttribute("href", "/tasks");
      expect(links[2]).toHaveAttribute("href", "/chat");
      expect(links[3]).toHaveAttribute("href", "/ai-personas");
      expect(within(navigation).getByRole("link", { name: "AI Personas" })).toHaveAttribute("href", "/ai-personas");
      expect(within(navigation).getByRole("link", { name: "Profile" })).toHaveAttribute("href", "/u/mina");
      expect(within(navigation).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
      expect(within(navigation).queryByRole("link", { name: "Followers" })).not.toBeInTheDocument();
    }
    expect(screen.getAllByRole("link", { name: "Open Feed" })).toHaveLength(2);
  });

  it("keeps AI Personas active on persona profiles without matching sibling route prefixes", () => {
    navigationState.pathname = "/ai-personas/moss";
    const view = render(<AppShell><p>Persona profile</p></AppShell>);

    for (const link of screen.getAllByRole("link", { name: "AI Personas" })) {
      expect(link).toHaveAttribute("aria-current", "page");
    }

    view.unmount();
    navigationState.pathname = "/ai-personas-archive";
    render(<AppShell><p>Different route</p></AppShell>);

    for (const link of screen.getAllByRole("link", { name: "AI Personas" })) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });
});
