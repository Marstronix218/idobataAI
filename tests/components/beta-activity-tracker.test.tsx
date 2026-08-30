import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pathname: "/feed" }));
const apiRequest = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("@/lib/client/api", () => ({ apiRequest, isPreviewMode: false }));

import { BetaActivityTracker } from "@/components/analytics/beta-activity-tracker";

describe("BetaActivityTracker", () => {
  it("sends a content-free activity pulse on mount and navigation", async () => {
    const view = render(<BetaActivityTracker />);
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
    expect(apiRequest).toHaveBeenLastCalledWith("/api/analytics/activity", {
      method: "POST",
    });

    state.pathname = "/tasks";
    view.rerender(<BetaActivityTracker />);
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2));
    expect(apiRequest.mock.calls.flat()).not.toContain("/tasks");
  });
});
