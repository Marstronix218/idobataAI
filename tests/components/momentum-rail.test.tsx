import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { MomentumRail } from "@/components/layout/momentum-rail";

describe("MomentumRail", () => {
  it("shows today’s focus and grounded performance metrics", () => {
    render(<MomentumRail />);

    expect(screen.getByRole("heading", { name: "Today’s tasks" })).toBeVisible();
    expect(screen.getByText("Plan and complete them in the task workspace.")).toBeVisible();
    expect(screen.getByText("Draft the project kickoff outline")).toBeVisible();
    expect(screen.getByText("Walk around the neighborhood for 20 minutes")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open Draft the project kickoff outline in Your Tasks" })).toHaveAttribute("href", "/tasks");
    expect(screen.getByRole("link", { name: "Go to Your Tasks" })).toHaveAttribute("href", "/tasks");
    expect(screen.getByRole("heading", { name: "Your momentum" })).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Daily goal progress" })).toHaveAttribute("aria-valuetext", "1 of 3 wins today");
    expect(screen.getByText(/Daily goals start at 3/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Change your daily goal in Settings" })).toHaveAttribute("href", "/settings#preferences");
    // The streak and today's completions are a label/value pair, not prose:
    // the streak explanation lives on the Your Tasks board, not in this rail.
    expect(screen.getByText("Current streak").nextElementSibling).toHaveTextContent(/^6 days$/);
    expect(screen.getByText("Completed today").nextElementSibling).toHaveTextContent(/^1 task$/);
    expect(screen.queryByText(/A streak is consecutive days/)).not.toBeInTheDocument();
  });

  it("has no automated accessibility violations", async () => {
    const { container } = render(<MomentumRail />);

    expect(await axe(container)).toHaveNoViolations();
  });
});
