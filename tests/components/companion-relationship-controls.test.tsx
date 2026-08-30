import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest, push } = vi.hoisted(() => ({ apiRequest: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/client/api", () => ({
  apiRequest,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : "Request failed.",
  isPreviewMode: false,
}));

import { CompanionRelationshipControls } from "@/components/companions/companion-relationship-controls";

describe("CompanionRelationshipControls", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    push.mockReset();
  });

  it("keeps user-initiated messaging available before a mutual follow", async () => {
    apiRequest.mockResolvedValue({});
    render(<CompanionRelationshipControls companionId="companion-1" companionName="Moss" />);

    const message = screen.getByRole("button", { name: "Message" });
    expect(message).toBeEnabled();
    fireEvent.click(message);

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/api/chat", {
      method: "POST",
      body: JSON.stringify({ companionId: "companion-1" }),
    }));
    expect(push).toHaveBeenCalledWith("/chat");
  });

  it("only shows proactive DM opt-in for a mutual relationship", () => {
    const { unmount } = render(<CompanionRelationshipControls companionId="companion-1" companionName="Moss" />);
    expect(screen.queryByRole("checkbox", { name: /Allow direct messages/ })).not.toBeInTheDocument();

    unmount();
    render(<CompanionRelationshipControls
      companionId="companion-1"
      companionName="Moss"
      initialRelationship={{ user_followed_at: "2026-08-20T00:00:00.000Z", companion_follow_state: "following", dm_opt_in: false }}
    />);

    expect(screen.getByRole("checkbox", { name: /Allow direct messages/ })).toBeVisible();
  });

  it("uses the relationship and memory API contracts", async () => {
    apiRequest.mockImplementation((path: string) => path.endsWith("/relationship")
      ? Promise.resolve({ relationship: { user_followed_at: "2026-08-20T00:00:00.000Z", companion_follow_state: "none", dm_opt_in: false } })
      : Promise.resolve(undefined));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<CompanionRelationshipControls companionId="companion-1" companionName="Moss" />);

    fireEvent.click(screen.getByRole("button", { name: "Follow" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/api/companions/companion-1/relationship", {
      method: "PUT",
      body: JSON.stringify({ action: "follow", following: true }),
    }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Clear memory" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Clear memory" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/api/companions/companion-1/memory", { method: "DELETE" }));
    confirm.mockRestore();
  });

  it("favorites only a followed persona and removes it independently", async () => {
    apiRequest.mockImplementation(() => Promise.resolve({
      relationship: {
        user_followed_at: "2026-08-20T00:00:00.000Z",
        companion_follow_state: "none",
        dm_opt_in: false,
        is_favorite: true,
        favorited_at: "2026-08-30T00:00:00.000Z",
      },
    }));
    render(<CompanionRelationshipControls
      companionId="companion-1"
      companionName="Moss"
      initialFavoriteCount={2}
      initialRelationship={{
        user_followed_at: "2026-08-20T00:00:00.000Z",
        companion_follow_state: "none",
        dm_opt_in: false,
        is_favorite: false,
        favorited_at: null,
      }}
    />);

    fireEvent.click(screen.getByRole("button", { name: "☆ Favorite" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/api/companions/companion-1/relationship", {
      method: "PUT",
      body: JSON.stringify({ action: "favorite", favorite: true }),
    }));
    expect(screen.getByText("3 / 3 Favorites")).toBeVisible();
  });
});
