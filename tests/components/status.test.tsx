import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";

import { AIBadge, PrivacyBadge } from "@/components/ui/status";

describe("AIBadge", () => {
  it("visibly identifies an AI companion", () => {
    render(<AIBadge />);

    expect(screen.getByText("AI companion")).toBeVisible();
  });

  it("visibly identifies generated AI content", () => {
    render(<AIBadge generated />);

    expect(screen.getByText("AI-generated")).toBeVisible();
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
