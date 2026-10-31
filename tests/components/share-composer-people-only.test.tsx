import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
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
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

import { ShareComposer } from "@/components/social/share-composer";

const taskId = "aaaaaaaa-0000-4000-8000-000000000001";

describe("ShareComposer audience under Pivot A", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockImplementation((path: string) => {
      if (path === "/api/tasks") return Promise.resolve([{
        id: taskId, owner_id: "user-1", title: "Water the plants", description: null, category: null,
        due_at: null, due_has_time: false, due_timezone: null, recurrence_rule: null, recurrence_instance_id: null,
        priority: null, visibility: "private", status: "completed", xp_earned: 0,
        completed_at: "2026-11-01T09:00:00.000Z", created_at: "2026-11-01T08:00:00.000Z", updated_at: "2026-11-01T09:00:00.000Z",
      }]);
      // The saved default would publish to the community.
      if (path === "/api/profile") return Promise.resolve({
        id: "user-1", username: "mina", display_name: "Mina", bio: null, avatar_url: null,
        profile_visibility: "public", daily_goal: 3, interests: [], default_task_visibility: "private",
        completion_visibility: "public", xp: 0, current_streak: 2, last_completion_date: null,
        created_at: "2026-11-01T08:00:00.000Z", updated_at: "2026-11-01T08:00:00.000Z",
      });
      if (path === `/api/tasks/${taskId}/publish`) return Promise.resolve({ id: "post-1" });
      return Promise.reject(new Error(`Unexpected path: ${path}`));
    });
  });

  it("starts at Only me whatever the saved default when sharing is people-only", async () => {
    const { container } = render(<ShareComposer taskId={taskId} peopleOnly />);

    expect(await screen.findByRole("button", { name: "Post privately" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Only me/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Community/ })).toHaveAttribute("aria-pressed", "false");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("keeps using the saved default with today's flags", async () => {
    render(<ShareComposer taskId={taskId} />);

    expect(await screen.findByRole("button", { name: "Post to Community" })).toBeVisible();
    expect(screen.getByRole("button", { name: /^Community/ })).toHaveAttribute("aria-pressed", "true");
  });

  const publishBody = () => {
    const call = apiRequest.mock.calls.find(([path]) => path === `/api/tasks/${taskId}/publish`);
    return JSON.parse(String((call?.[1] as RequestInit | undefined)?.body ?? "null"));
  };

  it("never offers or sends the legacy streak tag when sharing is people-only", async () => {
    render(<ShareComposer taskId={taskId} peopleOnly />);

    fireEvent.click(await screen.findByRole("button", { name: "Post privately" }));

    await waitFor(() => expect(publishBody()).toMatchObject({ showStreakTag: false }));
    expect(screen.queryByText(/streak/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove streak tag" })).not.toBeInTheDocument();
  });

  it("keeps the streak tag on by default with today's flags", async () => {
    render(<ShareComposer taskId={taskId} />);

    expect(await screen.findByText(/2-day streak/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Remove streak tag" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Post to Community" }));

    await waitFor(() => expect(publishBody()).toMatchObject({ showStreakTag: true }));
  });
});
