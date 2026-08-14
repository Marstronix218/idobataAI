import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { TaskBoard } from "@/components/tasks/task-board";

describe("TaskBoard", () => {
  it("presents one focused Your Tasks workspace with streaks and no XP", () => {
    render(<TaskBoard />);

    expect(screen.getByRole("heading", { name: "Your Tasks" })).toBeVisible();
    expect(screen.getByText("6")).toBeVisible();
    expect(screen.getByText("day streak")).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Daily task goal" })).toHaveAttribute("aria-valuetext", "1 of 3 tasks completed today");
    expect(screen.queryByText(/XP/)).not.toBeInTheDocument();
  });

  it("captures a dated recurring chore without a separate chore column", () => {
    render(<TaskBoard />);

    fireEvent.change(screen.getByLabelText("Add a task"), { target: { value: "Take the bins out" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Life admin" } });
    fireEvent.change(screen.getByLabelText("Repeat schedule"), { target: { value: "weekly" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    expect(screen.getByText("Take the bins out")).toBeVisible();
    expect(screen.getByText("Weekly")).toBeVisible();
    expect(screen.getByText(/added privately/)).toBeVisible();
  });

  it("keeps completion private and offers posting or undo afterward", () => {
    render(<TaskBoard />);

    fireEvent.click(screen.getByRole("button", { name: "Complete: Draft the project kickoff outline" }));

    expect(screen.getByText("Task complete")).toBeVisible();
    expect(screen.getByText("Nothing was posted. Add a note or photos only if you want to share this win.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Post a win" })).toHaveAttribute("href", "/tasks/kickoff-outline/share");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText("Draft the project kickoff outline moved back to open tasks.")).toBeVisible();
  });

  it("keeps posting available from the completed list after the success prompt is dismissed", () => {
    render(<TaskBoard />);

    fireEvent.click(screen.getByRole("button", { name: "Complete: Draft the project kickoff outline" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    fireEvent.click(screen.getByRole("button", { name: /Completed/ }));

    expect(screen.getAllByRole("link", { name: "Post a win" }).some(
      (link) => link.getAttribute("href") === "/tasks/kickoff-outline/share",
    )).toBe(true);
  });

  it("has no automated accessibility violations", async () => {
    const { container } = render(<TaskBoard />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
