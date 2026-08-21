import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("@/lib/client/api", () => ({
  apiRequest,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : "Request failed.",
  isPreviewMode: false,
}));

import { MomentumRail } from "@/components/layout/momentum-rail";

describe("MomentumRail production due dates", () => {
  beforeEach(() => {
    apiRequest.mockReset();
  });

  it("shows date-only deadlines at midnight instead of their stored noon sentinel", async () => {
    const storedDueDate = new Date();
    storedDueDate.setHours(12, 0, 0, 0);
    const midnight = new Date(storedDueDate);
    midnight.setHours(0, 0, 0, 0);
    const formatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

    apiRequest.mockImplementation((path: string) => {
      if (path === "/api/tasks") {
        return Promise.resolve([{
          id: "today-task",
          title: "Review the launch checklist",
          due_at: storedDueDate.toISOString(),
          status: "pending",
          completed_at: null,
        }]);
      }
      if (path === "/api/profile") return Promise.resolve({ daily_goal: 3, current_streak: 0 });
      return Promise.reject(new Error(`Unexpected path: ${path}`));
    });

    render(<MomentumRail />);

    expect(await screen.findByText("Review the launch checklist")).toBeVisible();
    expect(screen.getByText(`Due ${formatter.format(midnight)} · Open in Your Tasks`)).toBeVisible();
    expect(screen.queryByText(`Due ${formatter.format(storedDueDate)} · Open in Your Tasks`)).not.toBeInTheDocument();
  });
});
