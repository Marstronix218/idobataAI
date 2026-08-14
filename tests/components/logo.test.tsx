import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";

import { Logo } from "@/components/ui/logo";

describe("Logo", () => {
  it("renders the wordmark and the face-and-check logo mark", () => {
    const { container } = render(<Logo />);

    const homeLink = screen.getByRole("link", { name: "idobataAI home" });
    expect(homeLink).toHaveAttribute("href", "/");
    expect(homeLink).toHaveTextContent("idobataAI");
    expect(container.querySelector("img")).toHaveAttribute("src", expect.stringContaining("logo-face.png"));
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("keeps the compact mark accessible through its link label", async () => {
    const { container } = render(<Logo compact />);

    expect(screen.getByRole("link", { name: "idobataAI home" })).toBeVisible();
    expect(screen.queryByText("idobataAI")).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("supports an authenticated home destination", () => {
    render(<Logo href="/feed" label="Open Feed" />);

    expect(screen.getByRole("link", { name: "Open Feed" })).toHaveAttribute("href", "/feed");
  });
});
