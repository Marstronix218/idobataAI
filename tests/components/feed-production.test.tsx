import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest, push } = vi.hoisted(() => ({ apiRequest: vi.fn(), push: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/client/api", () => ({
  apiRequest,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : "Request failed.",
  isPreviewMode: false,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) } }),
}));

import { Feed } from "@/components/social/feed";

describe("Feed production data loading", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    push.mockReset();
    apiRequest.mockImplementation((path: string) => {
      if (path === "/api/profile") return Promise.resolve({ interests: ["Work"] });
      if (path.startsWith("/api/progress")) return Promise.resolve([{ task_id: "progress-1", username: "mina", task_title: "Ship the review", category: "Work", status: "completed", xp_value: 0, updated_at: "2026-08-14T12:00:00.000Z" }]);
      if (path.startsWith("/api/feed")) return Promise.resolve({ items: [], nextCursor: null });
      return Promise.reject(new Error(`Unexpected path: ${path}`));
    });
  });

  it("preserves public human progress when switching to People only", async () => {
    render(<Feed />);
    await screen.findByText("Ship the review");

    fireEvent.click(screen.getByRole("tab", { name: "People only" }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      "/api/progress?limit=8",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    await waitFor(() => expect(apiRequest.mock.calls.filter(([path]) => path === "/api/progress?limit=8")).toHaveLength(2));
    expect(screen.getByText("Ship the review")).toBeVisible();
  });
});
