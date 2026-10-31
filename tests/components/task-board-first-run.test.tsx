import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("@/lib/client/api", () => ({
  apiRequest,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : "Request failed.",
  isPreviewMode: false,
}));

import { TaskBoard } from "@/components/tasks/task-board";

// A brand-new account: no tasks yet, so the first-run steps show.
beforeEach(() => {
  apiRequest.mockReset();
  apiRequest.mockImplementation((path: string) => {
    if (path === "/api/tasks" || path === "/api/task-categories") return Promise.resolve([]);
    if (path === "/api/profile") return Promise.resolve({ daily_goal: 3, current_streak: 0, default_task_visibility: "private" });
    return Promise.reject(new Error(`Unexpected path: ${path}`));
  });
});

async function firstRunSteps() {
  const section = (await screen.findByRole("heading", { name: "Start with one small thing." })).closest("section")!;
  return within(section).getAllByRole("listitem").map((item) => item.textContent ?? "");
}

describe("TaskBoard first run", () => {
  it("keeps the post-the-win step with today's flags", async () => {
    render(<TaskBoard shareWin />);

    const steps = await firstRunSteps();
    expect(steps).toHaveLength(3);
    expect(steps[2]).toContain("AI personas and other members can react");
  });

  it("drops the step about personas reacting under Pivot A, even with sharing on", async () => {
    render(<TaskBoard shareWin pivotA />);

    const steps = await firstRunSteps();
    expect(steps).toHaveLength(2);
    expect(steps.join(" ")).not.toMatch(/persona/i);
  });
});
