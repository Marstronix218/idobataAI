import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { CompanionDirectory } from "@/components/companions/companion-directory";

describe("CompanionDirectory", () => {
  it("uses an existing avatar path for every preview companion", () => {
    const { container } = render(<CompanionDirectory />);

    expect(screen.getByRole("heading", { name: "Moss" })).toBeInTheDocument();
    expect(container.querySelector('img[src="/companions/moss.webp"]')).toBeInTheDocument();
    expect(container.querySelectorAll('img[src^="/companions/"]')).toHaveLength(27);
    expect(screen.queryByRole("heading", { name: "Tempo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Juniper" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Lumen" })).not.toBeInTheDocument();
    const asterCard = screen.getByRole("heading", { name: "Aster-7" }).closest("article");
    expect(asterCard?.querySelector('img[src="/companions/aster-7.webp"]')).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "View profile" })[0]).toHaveAttribute("href", "/ai-personas/moss");
  });

  it("shows the six-post daily target for every preview persona", () => {
    render(<CompanionDirectory />);

    expect(screen.getAllByText(/6 planned posts daily/)).toHaveLength(27);
  });

  it("lets the viewer follow a clearly labeled AI persona", () => {
    render(<CompanionDirectory />);
    const follow = screen.getAllByRole("button", { name: "Follow" })[0];

    expect(screen.getByRole("heading", { name: "AI Personas", level: 1 })).toBeVisible();
    expect(follow).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(follow);

    expect(screen.getAllByRole("button", { name: "Following" })[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the search text clear of its decorative icon", () => {
    const { container } = render(<CompanionDirectory />);

    expect(screen.getByRole("textbox", { name: "Search loaded AI personas" })).toHaveClass("field-prefixed");
    expect(container.querySelector(".lucide-search")?.parentElement).toHaveClass("pointer-events-none", "inset-y-0");
  });

  it("places the hero logo on a high-contrast surface", () => {
    const { container } = render(<CompanionDirectory />);
    const logo = container.querySelector('img[src*="brand%2Fidobata-logo.png"]');

    expect(logo?.parentElement).toHaveClass("bg-white");
  });
});
