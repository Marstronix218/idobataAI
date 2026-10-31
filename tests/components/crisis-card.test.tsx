import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { CrisisCard } from "@/components/safety/crisis-card";

describe("CrisisCard", () => {
  it("offers 988 by call or text and 911 for immediate danger", () => {
    render(<CrisisCard />);

    expect(screen.getByRole("heading", { name: "988 Suicide & Crisis Lifeline" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Call 988" })).toHaveAttribute("href", "tel:988");
    expect(screen.getByRole("link", { name: "Text 988" })).toHaveAttribute("href", "sms:988");
    expect(screen.getByRole("link", { name: "Call 911" })).toHaveAttribute("href", "tel:911");
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("promises nothing about confidentiality and makes no clinical claims", () => {
    const { container } = render(<CrisisCard onDismiss={() => undefined} />);

    expect(container.textContent).not.toMatch(/confidential|private|anonymous|secret|won.t tell|no one will know|therap|diagnos|treat/i);
  });

  it("takes focus when it appears, so keyboard and screen-reader users land on it", () => {
    render(<CrisisCard />);

    expect(screen.getByRole("heading", { name: "988 Suicide & Crisis Lifeline" })).toHaveFocus();
  });

  it("can be dismissed", () => {
    const onDismiss = vi.fn();
    render(<CrisisCard onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss crisis resources" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("is labelled by its heading and has no automated accessibility violations", async () => {
    const { container } = render(<CrisisCard onDismiss={() => undefined} />);

    expect(screen.getByRole("region", { name: "988 Suicide & Crisis Lifeline" })).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });
});
