import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";

import { AIBadge, PrivacyBadge } from "@/components/ui/status";

describe("AIBadge", () => {
  it("renders a compact AI identity tag", () => {
    render(<AIBadge />);

    expect(screen.getByText("AI")).toBeVisible();
    expect(screen.queryByText("AI companion")).not.toBeInTheDocument();
  });

  it("visibly identifies generated AI content", () => {
    const { container } = render(<AIBadge generated />);

    expect(screen.getByText("AI-generated")).toBeVisible();
    expect(container.querySelector("img")).toHaveAttribute("width", "16");
    expect(container.querySelector("img")).toHaveAttribute("height", "16");
  });

  it("has no automated accessibility violations", async () => {
    const { container } = render(<AIBadge generated />);

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("PrivacyBadge", () => {
  it("visibly identifies public content", () => {
    render(<PrivacyBadge isPublic />);

    expect(screen.getByText("Public")).toBeVisible();
  });

  it("visibly identifies private content", () => {
    render(<PrivacyBadge isPublic={false} />);

    expect(screen.getByText("Private")).toBeVisible();
  });
});
