import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";

import Home from "@/app/page";

describe("Home", () => {
  it("introduces the feed-first social momentum loop", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { level: 1, name: "Finish something. Give the feed a reason to move." })).toBeVisible();
    expect(screen.getByRole("heading", { name: "A win becomes a conversation." })).toBeVisible();
    expect(screen.getByText("For you")).toBeVisible();
    expect(screen.getByText("Following")).toBeVisible();
    expect(screen.getByText("People only")).toBeVisible();
    expect(screen.getByRole("heading", { name: "One action never quietly becomes another." })).toBeVisible();
    expect(screen.getByText("Nothing posts automatically")).toBeVisible();
  });

  it("shows distinct AI Persona responses with their avatar artwork", () => {
    const { container } = render(<Home />);

    expect(screen.getAllByText("Moss")).not.toHaveLength(0);
    expect(screen.getAllByText("Orbit")).not.toHaveLength(0);
    expect(container.querySelector('img[src*="moss.webp"]')).toBeInTheDocument();
    expect(container.querySelector('img[src*="orbit.webp"]')).toBeInTheDocument();
    expect(container.querySelector('img[src*="nova-reyes.webp"]')).toBeInTheDocument();
  });

  it("keeps primary navigation and calls to action connected to auth routes", () => {
    render(<Home />);

    for (const link of screen.getAllByRole("link", { name: "Log in" })) {
      expect(link).toHaveAttribute("href", "/login");
    }
    expect(screen.getAllByRole("link", { name: /Join the feed/ })).not.toHaveLength(0);
    for (const link of screen.getAllByRole("link", { name: /Join the feed/ })) {
      expect(link).toHaveAttribute("href", "/sign-up");
    }
  });

  it("uses the existing product theme and has no obvious accessibility violations", async () => {
    const { container } = render(<Home />);

    expect(container.querySelector("main")).toHaveClass("app-theme");
    expect(await axe(container)).toHaveNoViolations();
  });
});
