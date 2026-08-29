import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest, refresh } = vi.hoisted(() => ({ apiRequest: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/client/api", () => ({
  apiRequest,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : "Request failed.",
}));

import { ProfileFollowButton } from "@/components/profile/profile-follow-button";

describe("ProfileFollowButton", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    refresh.mockReset();
  });

  it("optimistically follows a human profile and refreshes its follower count", async () => {
    apiRequest.mockResolvedValue({ state: "following" });
    render(<ProfileFollowButton userId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" profileName="Jonah" />);

    const follow = screen.getByRole("button", { name: "Follow Jonah" });
    fireEvent.click(follow);

    expect(screen.getByRole("button", { name: "Unfollow Jonah" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      "/api/users/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/follow",
      { method: "PUT" },
    ));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("files a request rather than a follow against a protected profile", async () => {
    apiRequest.mockResolvedValue({ state: "requested" });
    render(<ProfileFollowButton userId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" profileName="Jonah" isPrivate />);

    fireEvent.click(screen.getByRole("button", { name: "Follow Jonah" }));

    expect(await screen.findByRole("button", { name: "Cancel follow request to Jonah" })).toHaveTextContent("Requested");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("withdraws a pending request with the same control", async () => {
    apiRequest.mockResolvedValue(undefined);
    render(<ProfileFollowButton userId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" profileName="Jonah" initialState="requested" isPrivate />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel follow request to Jonah" }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      "/api/users/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/follow",
      { method: "DELETE" },
    ));
    expect(screen.getByRole("button", { name: "Follow Jonah" })).toHaveAttribute("aria-pressed", "false");
  });

  it("reverts the optimistic state when following fails", async () => {
    apiRequest.mockRejectedValue(new Error("This profile cannot be followed."));
    render(<ProfileFollowButton userId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" profileName="Jonah" />);

    fireEvent.click(screen.getByRole("button", { name: "Follow Jonah" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This profile cannot be followed.");
    expect(screen.getByRole("alert")).not.toHaveClass("sr-only");
    expect(screen.getByRole("button", { name: "Follow Jonah" })).toHaveAttribute("aria-pressed", "false");
    expect(refresh).not.toHaveBeenCalled();
  });
});
