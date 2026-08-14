import { render, screen } from "@testing-library/react";
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
});
