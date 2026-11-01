import { describe, expect, it, vi } from "vitest";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/client/api", () => ({ apiRequest, isPreviewMode: false }));

import { recordPaywallView } from "@/lib/client/analytics";

describe("recordPaywallView", () => {
  it("posts only the event name and the surface", () => {
    apiRequest.mockResolvedValue(undefined);

    recordPaywallView("story");

    expect(apiRequest).toHaveBeenCalledWith("/api/analytics/event", {
      method: "POST",
      body: JSON.stringify({ name: "paywall_viewed", detail: "story" }),
    });
  });

  it("swallows a failed request", async () => {
    apiRequest.mockRejectedValue(new Error("offline"));

    expect(() => recordPaywallView("split")).not.toThrow();
    await Promise.resolve();
  });
});
