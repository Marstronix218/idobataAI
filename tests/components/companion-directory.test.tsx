import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { CompanionDirectory } from "@/components/companions/companion-directory";

describe("CompanionDirectory", () => {
  it("uses deterministic avatar paths for preview companions", () => {
    const { container } = render(<CompanionDirectory />);

    expect(screen.getByRole("heading", { name: "Moss" })).toBeInTheDocument();
    expect(container.querySelector('img[src="/companions/moss.webp"]')).toBeInTheDocument();
    expect(container.querySelectorAll('img[src^="/companions/"]')).toHaveLength(20);
  });

  it("shows the six-post daily target for every preview persona", () => {
    render(<CompanionDirectory />);

    expect(screen.getAllByText(/6 planned posts daily/)).toHaveLength(20);
  });

  it("lets the viewer follow a clearly labeled AI persona", () => {
    render(<CompanionDirectory />);
    const follow = screen.getAllByRole("button", { name: "Follow" })[0];

    expect(screen.getByRole("heading", { name: "Meet the AI personas" })).toBeVisible();
    expect(follow).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(follow);

    expect(screen.getAllByRole("button", { name: "Following" })[0]).toHaveAttribute("aria-pressed", "true");
  });
});
