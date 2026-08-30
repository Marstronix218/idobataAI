import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest, push } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/client/api", () => ({
  apiRequest,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : "Request failed.",
  isPreviewMode: false,
}));

import { ActivityList } from "@/components/activity/activity-list";

const unreadNotification = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  actor_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  companion_id: null,
  post_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  reply_id: null,
  kind: "reaction" as const,
  read_at: null,
  created_at: "2026-08-20T12:00:00.000Z",
  user_profiles: { username: "kai", avatar_url: null },
  social_companions: null,
  social_posts: { content: "A useful update", task_title: "Ship the fix", content_status: "active" },
};

describe("ActivityList production loading", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    push.mockReset();
    apiRequest.mockImplementation((path: string) => {
      if (path === "/api/notifications?limit=30") {
        return Promise.resolve({ items: [unreadNotification], nextCursor: null });
      }
      if (path === "/api/notifications/unread-count") {
        return Promise.resolve({ unread: 1 });
      }
      return Promise.reject(new Error(`Unexpected path: ${path}`));
    });
  });

  it("loads one notification list from the server alongside the unread count", async () => {
    render(<ActivityList />);

    expect(await screen.findByRole("button", { name: /Open notification from kai/ })).toBeVisible();
    expect(screen.getByText("1 unread")).toBeVisible();
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      "/api/notifications?limit=30",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    // No second request: the dropped Unread view was the only reason to refetch.
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });
});
