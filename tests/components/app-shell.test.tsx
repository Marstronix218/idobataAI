import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/feed",
}));

import { AppShell } from "@/components/layout/app-shell";

describe("AppShell", () => {
  it("presents distinct Profile and Settings tabs on desktop and mobile", () => {
    render(<AppShell><p>Community timeline</p></AppShell>);

    for (const navigation of screen.getAllByRole("navigation", { name: "Primary navigation" })) {
      const links = within(navigation).getAllByRole("link");
      expect(links).toHaveLength(6);
      expect(links[0]).toHaveAttribute("href", "/feed");
      expect(links[0]).toHaveAttribute("aria-current", "page");
      expect(links[1]).toHaveAttribute("href", "/tasks");
      expect(within(navigation).getByRole("link", { name: "Profile" })).toHaveAttribute("href", "/u/mina");
      expect(within(navigation).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
      expect(within(navigation).queryByRole("link", { name: "Followers" })).not.toBeInTheDocument();
    }
    expect(screen.getAllByRole("link", { name: "Open Feed" })).toHaveLength(2);
  });
});
