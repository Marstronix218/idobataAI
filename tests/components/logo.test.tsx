import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";

import { Logo, LogoMark } from "@/components/ui/logo";

describe("LogoMark", () => {
  it("renders the decorative brand mark at an arbitrary pixel size", () => {
    const { container } = render(<LogoMark size={37} className="custom-mark" />);

    const logoImage = container.querySelector("img");
    expect(logoImage).toHaveAttribute("src", expect.stringContaining("brand%2Fidobata-logo.png"));
    expect(logoImage).toHaveAttribute("width", "37");
    expect(logoImage).toHaveAttribute("height", "37");
    expect(logoImage).toHaveAttribute("alt", "");
    expect(logoImage).toHaveAttribute("aria-hidden", "true");
    expect(logoImage).toHaveClass("custom-mark");
  });
});

describe("Logo", () => {
  it("renders the wordmark and the face-and-check logo mark", () => {
    const { container } = render(<Logo />);

    const homeLink = screen.getByRole("link", { name: "idobataAI home" });
    expect(homeLink).toHaveAttribute("href", "/");
    expect(homeLink).toHaveTextContent("idobataAI");
    expect(screen.getByText("AI")).toHaveClass("text-brand");
    expect(screen.getByText("AI")).not.toHaveClass("text-community");
    const logoImage = container.querySelector("img");
    expect(logoImage).toHaveAttribute("src", expect.stringContaining("brand%2Fidobata-logo.png"));
    expect(logoImage).toHaveAttribute("alt", "");
    expect(logoImage).toHaveAttribute("width", "48");
    expect(logoImage).toHaveAttribute("height", "48");
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

  it("supports a larger pre-auth brand treatment", () => {
    const { container } = render(<Logo size="large" />);

    const homeLink = screen.getByRole("link", { name: "idobataAI home" });
    expect(homeLink).toHaveClass("sm:gap-3");
    expect(homeLink.querySelector("span")).toHaveClass("text-[1.75rem]", "sm:text-[2rem]");
    expect(container.querySelector("img")).toHaveAttribute("width", "64");
    expect(container.querySelector("img")).toHaveAttribute("height", "64");
  });
});
