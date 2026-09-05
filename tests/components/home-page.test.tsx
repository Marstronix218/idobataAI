import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";

import Home from "@/app/page";

describe("Home", () => {
  it("introduces the feed-first social momentum loop", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { level: 1, name: "Finish something. Give the feed a reason to move." })).toBeVisible();
    expect(screen.getByRole("heading", { name: "A shared win can start a conversation." })).toBeVisible();
    expect(screen.getByText("For you")).toBeVisible();
    expect(screen.getByText("Following")).toBeVisible();
    expect(screen.getByText("People only")).toBeVisible();
    const promotionHeading = screen.getByRole("heading", { name: "From a finished task to a conversation." });
    const promotionVideo = screen.getByLabelText("idobataAI beta product preview");
    const promotionGrid = promotionVideo.closest("section")?.firstElementChild;
    expect(promotionHeading).toBeVisible();
    expect(promotionVideo).toBeVisible();
    expect(promotionGrid?.firstElementChild).toContainElement(promotionVideo);
    expect(promotionGrid?.lastElementChild).toContainElement(promotionHeading);
    expect(screen.queryByText("Plays automatically without sound while it is in view.")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Completing and posting are separate actions." })).toBeVisible();
    expect(screen.getByText("Completing a task never posts it")).toBeVisible();
    expect(screen.queryByText(/One posted win\. Two replies/)).not.toBeInTheDocument();
  });

  it("shows distinct AI Persona responses with their avatar artwork", () => {
    const { container } = render(<Home />);

    expect(screen.getAllByText("Sora")).not.toHaveLength(0);
    expect(screen.getAllByText("Rika Kisaragi")).not.toHaveLength(0);
    expect(screen.getAllByText("Vex")).not.toHaveLength(0);
    expect(container.querySelector('img[src*="sora.webp"]')).toBeInTheDocument();
    expect(container.querySelector('img[src*="rika-kisaragi.webp"]')).toBeInTheDocument();
    expect(container.querySelector('img[src*="vex.webp"]')).toBeInTheDocument();
    expect(container.querySelector('img[src*="hikari-amane.webp"]')).toBeInTheDocument();
    expect(container.querySelector('img[src*="mio-spark.webp"]')).toBeInTheDocument();
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
