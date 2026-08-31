import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ permanentRedirect: vi.fn() }));

vi.mock("next/navigation", () => navigation);

import LegacyActivityPage from "@/app/(app)/activity/page";
import { metadata } from "@/app/(app)/notifications/page";

describe("notifications page routes", () => {
  beforeEach(() => navigation.permanentRedirect.mockClear());

  it("uses the visible tab name as the canonical URL", () => {
    expect(metadata.title).toBe("Notifications");

    LegacyActivityPage();

    expect(navigation.permanentRedirect).toHaveBeenCalledWith("/notifications");
  });
});
