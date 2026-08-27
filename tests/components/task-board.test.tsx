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

  it("labels task groups with task counts instead of guidance copy", () => {
    render(<TaskBoard />);

    for (const title of ["Write the release note", "Send the follow-up"]) {
      fireEvent.change(screen.getByLabelText("Add a task"), { target: { value: title } });
      fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    }

    expect(screen.getByRole("heading", { name: "Today" }).parentElement).toHaveTextContent("3 tasks");
    expect(screen.queryByText("Your next clear steps")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Upcoming/ }));
    expect(screen.getByRole("heading", { name: "Upcoming" }).parentElement).toHaveTextContent("1 task");
    expect(screen.queryByText("What is coming next")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /All/ }));
    expect(screen.getByRole("heading", { name: "Today" }).parentElement).toHaveTextContent("3 tasks");
    expect(screen.getByRole("heading", { name: "Upcoming" }).parentElement).toHaveTextContent("1 task");
    expect(screen.getByRole("heading", { name: "Anytime" }).parentElement).toHaveTextContent("1 task");
    expect(screen.queryByText("Due now")).not.toBeInTheDocument();
    expect(screen.queryByText("Planned ahead")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Completed/ }));
    expect(screen.getByRole("heading", { name: "Completed" }).parentElement).toHaveTextContent("1 task");
    expect(screen.queryByText("Ready to revisit or post")).not.toBeInTheDocument();
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

  it("labels the completed-list action as Post after the success prompt is dismissed", () => {
    render(<TaskBoard />);

    fireEvent.click(screen.getByRole("button", { name: "Complete: Draft the project kickoff outline" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss completion message" }));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole("button", { name: /Completed/ }));

    expect(screen.getAllByRole("link", { name: "Post" }).some(
      (link) => link.getAttribute("href") === "/tasks/kickoff-outline/share",
    )).toBe(true);
  });

  it("keeps priority optional and spells out selected priority values", () => {
    render(<TaskBoard />);

    const prioritySelect = screen.getByRole("combobox", { name: "Priority (optional)" });
    expect(prioritySelect).toHaveValue("");
    expect(within(prioritySelect).getAllByRole("option").map((option) => option.getAttribute("value"))).toEqual(["", "1", "2", "3", "4"]);
    expect(within(prioritySelect).getByRole("option", { name: "No priority" })).toBeInTheDocument();
    expect(within(prioritySelect).getByRole("option", { name: "Priority 1: Highest" })).toBeInTheDocument();

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

  it("lets users add and remove an exact deadline time without losing the due date", () => {
    render(<TaskBoard />);

    const dueDate = screen.getByLabelText("Due date");
    const deadlineTime = screen.getByLabelText("Deadline time (optional)");
    const originalDueDate = (dueDate as HTMLInputElement).value;
    expect(deadlineTime).toHaveValue("");
    expect(deadlineTime).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Add a task"), { target: { value: "Outline the proposal" } });
    fireEvent.change(deadlineTime, { target: { value: "13:45" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    const timedTask = screen.getByRole("heading", { name: "Outline the proposal" }).closest("article");
    expect(timedTask).not.toBeNull();
    expect(within(timedTask!).getByText(/deadline/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Edit Outline the proposal" }));
    const editDialog = screen.getByRole("dialog", { name: "Edit task" });
    const editDueDate = within(editDialog).getByLabelText("Due date");
    const editDeadlineTime = within(editDialog).getByLabelText("Deadline time (optional)");
    expect(editDueDate).toHaveValue(originalDueDate);
    expect(editDeadlineTime).toHaveValue("13:45");
    fireEvent.click(within(editDialog).getByRole("button", { name: "Clear deadline time" }));
    expect(editDueDate).toHaveValue(originalDueDate);
    expect(editDeadlineTime).toHaveValue("");
    fireEvent.click(within(editDialog).getByRole("button", { name: "Save changes" }));

    const updatedTask = screen.getByRole("heading", { name: "Outline the proposal" }).closest("article");
    expect(updatedTask).not.toBeNull();
    expect(within(updatedTask!).getByText("Today")).toBeVisible();
    expect(within(updatedTask!).queryByText(/deadline/)).not.toBeInTheDocument();
  });

  it("clears deadline time when its due date is removed", () => {
    render(<TaskBoard />);

    const dueDate = screen.getByLabelText("Due date");
    const deadlineTime = screen.getByLabelText("Deadline time (optional)");
    fireEvent.change(deadlineTime, { target: { value: "09:30" } });
    fireEvent.change(dueDate, { target: { value: "" } });

    expect(deadlineTime).toBeDisabled();
    expect(deadlineTime).toHaveValue("");
  });

  it("lets users explicitly unselect a quick deadline time without clearing the due date", () => {
    render(<TaskBoard />);

    const dueDate = screen.getByLabelText("Due date");
    const deadlineTime = screen.getByLabelText("Deadline time (optional)");
    const originalDueDate = (dueDate as HTMLInputElement).value;

    fireEvent.change(deadlineTime, { target: { value: "09:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear deadline time for new task" }));

    expect(dueDate).toHaveValue(originalDueDate);
    expect(deadlineTime).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Clear deadline time for new task" })).not.toBeInTheDocument();
  });

  it("treats a past timed task as overdue while a date-only task stays due today", () => {
    render(<TaskBoard />);

    fireEvent.change(screen.getByLabelText("Add a task"), { target: { value: "Flexible task" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    const flexibleTask = screen.getByRole("heading", { name: "Flexible task" }).closest("article");
    expect(flexibleTask).not.toBeNull();
    expect(within(flexibleTask!).getByText("Today")).toBeVisible();
    expect(within(flexibleTask!).queryByText(/Overdue/)).not.toBeInTheDocument();

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const previousDate = [
      yesterday.getFullYear(),
      String(yesterday.getMonth() + 1).padStart(2, "0"),
      String(yesterday.getDate()).padStart(2, "0"),
    ].join("-");
    fireEvent.change(screen.getByLabelText("Add a task"), { target: { value: "Timed task" } });
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: previousDate } });
    fireEvent.change(screen.getByLabelText("Deadline time (optional)"), { target: { value: "13:59" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    const timedTask = screen.getByRole("heading", { name: "Timed task" }).closest("article");
    expect(timedTask).not.toBeNull();
    expect(within(timedTask!).getByText(/Overdue · .* at/)).toBeVisible();

    fireEvent.click(within(timedTask!).getByRole("button", { name: "Complete: Timed task" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss completion message" }));
    fireEvent.click(screen.getByRole("button", { name: /Completed/ }));
    const completedTask = screen.getByRole("heading", { name: "Timed task" }).closest("article");
    expect(completedTask).not.toBeNull();
    expect(within(completedTask!).queryByText(/Overdue/)).not.toBeInTheDocument();
    expect(within(completedTask!).getByText(/deadline/)).toBeVisible();
  });

  it("keeps leading and trailing task-field icons clear of their labels", () => {
    render(<TaskBoard />);

    expect(screen.getByLabelText("Due date")).not.toHaveClass("field-prefixed");
    expect(screen.getByLabelText("Category (optional)")).toHaveClass("field-prefixed", "field-suffixed");
    expect(screen.getByLabelText("Repeat schedule")).toHaveClass("field-prefixed", "field-suffixed");
    expect(screen.getByLabelText("Priority (optional)")).toHaveClass("field-prefixed", "field-suffixed");
    expect(screen.getByLabelText("Deadline time (optional)")).toHaveClass("field-prefixed");
    expect(screen.getByLabelText("Filter by category")).toHaveClass("field-prefixed", "field-suffixed");
  });

  it("aligns every edit-task dropdown arrow", () => {
    render(<TaskBoard />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Draft the project kickoff outline" }));

    const editDialog = screen.getByRole("dialog", { name: "Edit task" });
    const dropdowns = [
      within(editDialog).getByRole("combobox", { name: "Category (optional)" }),
      within(editDialog).getByRole("combobox", { name: "Priority (optional)" }),
      within(editDialog).getByRole("combobox", { name: "Repeat" }),
      within(editDialog).getByRole("combobox", { name: "Visibility" }),
    ];

    for (const dropdown of dropdowns) {
      expect(dropdown).toHaveClass("field-suffixed", "appearance-none");
      expect(dropdown.parentElement).toHaveClass("relative");
      const arrow = dropdown.parentElement?.querySelector("svg");
      expect(arrow).toHaveClass("absolute", "right-3", "top-1/2", "-translate-y-1/2");
      expect(arrow).toHaveAttribute("width", "16");
      expect(arrow).toHaveAttribute("height", "16");
    }
  });

  it("keeps the quick controls stacked through tablet widths before using the roomy desktop grid", () => {
    render(<TaskBoard />);

    const recurrence = screen.getByRole("combobox", { name: "Repeat schedule" });
    const controlGrid = recurrence.closest("div.grid");
    expect(controlGrid).not.toBeNull();
    expect(controlGrid).toHaveClass("sm:grid-cols-2", "lg:grid-cols-3", "xl:grid-cols-[155px_minmax(145px,1fr)_175px_190px_165px]");
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
