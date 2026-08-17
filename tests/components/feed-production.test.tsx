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
      if (path.startsWith("/api/feed")) return Promise.resolve({ items: [], nextCursor: null });
      return Promise.reject(new Error(`Unexpected path: ${path}`));
    });
  });

  it("loads feed posts without requesting a separate progress interstitial", async () => {
    render(<Feed />);
    await screen.findByRole("heading", { name: "No posts here yet." });

    fireEvent.click(screen.getByRole("tab", { name: "People only" }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      "/api/feed?scope=people&limit=10",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    expect(apiRequest.mock.calls.some(([path]) => path.startsWith("/api/progress"))).toBe(false);
    expect(screen.queryByText("Up to date · refreshed just now")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Community progress" })).not.toBeInTheDocument();
  });
});
