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

  // The list feed carries `reply_count` and does not join reply bodies. A card
  // must therefore render from a payload with no replies attached: reading
  // `social_replies.length` on that shape crashed the whole feed route.
  it("renders a post that carries a reply count without reply bodies", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === "/api/profile") return Promise.resolve({ interests: ["Work"] });
      if (path.startsWith("/api/feed")) {
        return Promise.resolve({
          items: [{
            id: "11111111-1111-4111-8111-111111111111",
            author_id: "22222222-2222-4222-8222-222222222222",
            companion_id: null,
            task_id: null,
            kind: "human_completion",
            visibility: "public",
            content_status: "active",
            content: "Finished the kitchen shelf.",
            task_title: "Build the shelf",
            category: "Home",
            xp_earned: 10,
            streak: null,
            completed_at: new Date().toISOString(),
            idempotency_key: null,
            source_key: null,
            image_paths: [],
            image_urls: [],
            is_ai_generated: false,
            reply_count: 7,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            user_profiles: { username: "mina", display_name: "Mina", avatar_url: null },
            social_companions: null,
            social_reactions: [],
            // Deliberately absent, not empty: this is the exact payload shape
            // that crashed the feed when the card read `.length` on it.
          }],
          nextCursor: null,
        });
      }
      return Promise.reject(new Error(`Unexpected path: ${path}`));
    });

    render(<Feed />);

    const reply = await screen.findByRole("button", { name: /Reply/ });
    expect(reply).toHaveTextContent("7");
    expect(screen.getByText("Finished the kitchen shelf.")).toBeVisible();
  });
});
