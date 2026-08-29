import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FollowRequest } from "@/types";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("@/lib/client/api", () => ({
  apiRequest,
  isPreviewMode: false,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : "Request failed.",
}));

import { FollowRequestInbox } from "@/components/profile/follow-request-inbox";

const requests: FollowRequest[] = [
  { requester_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", username: "mina", display_name: "Mina", avatar_url: null, bio: "Slow mornings.", created_at: "2026-08-27T00:00:00.000Z" },
  { requester_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", username: "jonah", display_name: null, avatar_url: null, bio: null, created_at: "2026-08-26T00:00:00.000Z" },
];

describe("FollowRequestInbox", () => {
  beforeEach(() => apiRequest.mockReset());

  it("lists everyone waiting on a protected profile", async () => {
    apiRequest.mockResolvedValue({ requests });
    render(<FollowRequestInbox />);

    expect(await screen.findByText("Mina")).toBeInTheDocument();
    // A person with no display name is still addressable by handle.
    expect(screen.getByText("@jonah")).toBeInTheDocument();
    expect(screen.getByText("2 waiting")).toBeInTheDocument();
  });

  it("accepts a request and drops it from the list", async () => {
    apiRequest.mockResolvedValueOnce({ requests });
    apiRequest.mockResolvedValueOnce({ state: "following" });
    render(<FollowRequestInbox />);

    fireEvent.click(await screen.findByRole("button", { name: "Accept follower request from Mina" }));

    await waitFor(() => expect(apiRequest).toHaveBeenLastCalledWith("/api/follow-requests", {
      method: "PUT",
      body: JSON.stringify({ requesterId: requests[0].requester_id, accept: true }),
    }));
    await waitFor(() => expect(screen.queryByText("Mina")).not.toBeInTheDocument());
    expect(screen.getByText("@jonah")).toBeInTheDocument();
  });

  it("declines a request without following the person", async () => {
    apiRequest.mockResolvedValueOnce({ requests });
    apiRequest.mockResolvedValueOnce({ state: "none" });
    render(<FollowRequestInbox />);

    fireEvent.click(await screen.findByRole("button", { name: "Decline follower request from jonah" }));

    await waitFor(() => expect(apiRequest).toHaveBeenLastCalledWith("/api/follow-requests", {
      method: "PUT",
      body: JSON.stringify({ requesterId: requests[1].requester_id, accept: false }),
    }));
    await waitFor(() => expect(screen.queryByText("@jonah")).not.toBeInTheDocument());
  });

  it("surfaces a failed response instead of silently dropping the row", async () => {
    apiRequest.mockResolvedValueOnce({ requests });
    apiRequest.mockRejectedValueOnce(new Error("no pending follow request"));
    render(<FollowRequestInbox />);

    fireEvent.click(await screen.findByRole("button", { name: "Accept follower request from Mina" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("no pending follow request");
    expect(screen.getByText("Mina")).toBeInTheDocument();
  });

  it("says so plainly when nobody is waiting", async () => {
    apiRequest.mockResolvedValue({ requests: [] });
    render(<FollowRequestInbox />);

    expect(await screen.findByRole("heading", { name: "Nobody is waiting" })).toBeInTheDocument();
  });
});
