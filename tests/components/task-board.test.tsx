import { fireEvent, render, screen, within } from "@testing-library/react";
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
    fireEvent.change(screen.getByLabelText("Category (optional)"), { target: { value: "Life admin" } });
    fireEvent.change(screen.getByLabelText("Repeat schedule"), { target: { value: "weekly" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    expect(screen.getByText("Take the bins out")).toBeVisible();
    expect(screen.getByText("Weekly")).toBeVisible();
    expect(screen.getByText(/added privately/)).toBeVisible();
  });

  it("keeps category optional and reuses user-created categories from a dropdown", async () => {
    render(<TaskBoard />);

    const categorySelect = screen.getByRole("combobox", { name: "Category (optional)" });
    expect(categorySelect).toHaveValue("");
    expect(within(categorySelect).getByRole("option", { name: "No category" })).toBeInTheDocument();
    expect(within(categorySelect).getByRole("option", { name: "Edit categories…" })).toBeInTheDocument();
    expect(screen.queryByText("Manage categories")).not.toBeInTheDocument();

    fireEvent.change(categorySelect, { target: { value: "__edit_categories__" } });
    expect(screen.getByRole("dialog", { name: "Edit categories" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Add a category"), { target: { value: "Errands" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Errands category added. Preview only.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close category editor" }));

    fireEvent.change(categorySelect, { target: { value: "Errands" } });
    fireEvent.change(screen.getByLabelText("Add a task"), { target: { value: "Pick up the parcel" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    expect(screen.getByText("Pick up the parcel")).toBeVisible();
    expect(screen.getAllByText("Errands").some((element) => element.classList.contains("badge-category"))).toBe(true);
  });

  it("renames and explicitly confirms deletion of reusable categories", async () => {
    render(<TaskBoard />);

    fireEvent.change(screen.getByRole("combobox", { name: "Category (optional)" }), { target: { value: "__edit_categories__" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename Work" }));
    fireEvent.change(screen.getByLabelText("New name for Work"), { target: { value: "Office" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Work renamed to Office. Preview only.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Delete Office" }));
    expect(screen.getByText("It will be cleared from 1 current task. Published posts will not change.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Remove category" }));

    expect(await screen.findByText("Office deleted and cleared from 1 current task. Preview only.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Delete Office" })).not.toBeInTheDocument();
  });

  it("keeps completion private and offers sharing or undo afterward", async () => {
    const { container } = render(<TaskBoard />);

    fireEvent.click(screen.getByRole("button", { name: "Complete: Draft the project kickoff outline" }));

    expect(screen.getByText("Done")).toBeVisible();
    // Completing a task must not move the user: resetting the filter and
    // category threw them out of the list they were working down, on the most
    // repeated interaction in the product. The celebration card is the
    // confirmation; the list stays where it was.
    expect(screen.getByRole("region", { name: "Today tasks" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Completed tasks" })).not.toBeInTheDocument();
    expect(screen.getByText("It stays off the feed unless you share it.")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Draft the project kickoff outline completed and remains off the feed.");
    expect(screen.getAllByRole("link", { name: "Share" }).some(
      (link) => link.getAttribute("href") === "/tasks/kickoff-outline/share",
    )).toBe(true);
    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText("Draft the project kickoff outline moved back to open tasks.")).toBeVisible();
  });

  it("keeps posting available from the completed list after the success prompt is dismissed", () => {
    render(<TaskBoard />);

    fireEvent.click(screen.getByRole("button", { name: "Complete: Draft the project kickoff outline" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss completion message" }));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole("button", { name: /Completed/ }));

    expect(screen.getAllByRole("link", { name: "Share" }).some(
      (link) => link.getAttribute("href") === "/tasks/kickoff-outline/share",
    )).toBe(true);
  });

  it("keeps priority optional and spells out selected priority values", () => {
    render(<TaskBoard />);

    const prioritySelect = screen.getByRole("combobox", { name: "Priority (optional)" });
    expect(prioritySelect).toHaveValue("");
    expect(within(prioritySelect).getAllByRole("option").map((option) => option.getAttribute("value"))).toEqual(["", "1", "2", "3", "4"]);
    expect(within(prioritySelect).getByRole("option", { name: "No priority" })).toBeInTheDocument();
    expect(within(prioritySelect).getByRole("option", { name: "Priority 1 — Highest" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Add a task"), { target: { value: "Handle the urgent request" } });
    fireEvent.change(prioritySelect, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    const urgentTask = screen.getByRole("heading", { name: "Handle the urgent request" }).closest("article");
    expect(urgentTask).not.toBeNull();
    expect(within(urgentTask!).getByText("Priority 1")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Edit Handle the urgent request" }));
    const editDialog = screen.getByRole("heading", { name: "Edit task" }).closest("form");
    expect(editDialog).not.toBeNull();
    fireEvent.change(within(editDialog!).getByRole("combobox", { name: "Priority (optional)" }), { target: { value: "" } });
    fireEvent.click(within(editDialog!).getByRole("button", { name: "Save changes" }));

    const taskArticle = screen.getByRole("heading", { name: "Handle the urgent request" }).closest("article");
    expect(taskArticle).not.toBeNull();
    expect(within(taskArticle!).queryByText(/Priority [1-4]/)).not.toBeInTheDocument();
  });

  it("keeps leading and trailing task-field icons clear of their labels", () => {
    render(<TaskBoard />);

    expect(screen.getByLabelText("Due date")).not.toHaveClass("field-prefixed");
    expect(screen.getByLabelText("Category (optional)")).toHaveClass("field-prefixed", "field-suffixed");
    expect(screen.getByLabelText("Repeat schedule")).toHaveClass("field-prefixed", "field-suffixed");
    expect(screen.getByLabelText("Priority (optional)")).toHaveClass("field-prefixed", "field-suffixed");
    expect(screen.getByLabelText("Filter by category")).toHaveClass("field-prefixed", "field-suffixed");
  });

  it("keeps the quick controls stacked through tablet widths before using the roomy desktop grid", () => {
    render(<TaskBoard />);

    const recurrence = screen.getByRole("combobox", { name: "Repeat schedule" });
    const controlGrid = recurrence.closest("div.grid");
    expect(controlGrid).not.toBeNull();
    expect(controlGrid).toHaveClass("sm:grid-cols-2", "lg:grid-cols-[175px_minmax(150px,1fr)_195px_210px]");
    expect(controlGrid).not.toHaveClass("md:grid-cols-[175px_minmax(150px,1fr)_180px_125px]");
  });

  it("has no automated accessibility violations", async () => {
    const { container } = render(<TaskBoard />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("keeps the category manager free of automated accessibility violations", async () => {
    const { container } = render(<TaskBoard />);
    fireEvent.change(screen.getByRole("combobox", { name: "Category (optional)" }), { target: { value: "__edit_categories__" } });
    expect(await axe(container)).toHaveNoViolations();
  });
});
