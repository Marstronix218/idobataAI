import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  permanentRedirect: vi.fn(),
}));

vi.mock("next/navigation", () => navigation);

import LegacyCompanionsPage from "@/app/(app)/companions/page";
import LegacyCompanionProfilePage from "@/app/(app)/companions/[companionId]/page";

describe("legacy companion page routes", () => {
  beforeEach(() => {
    navigation.permanentRedirect.mockClear();
  });

  it("permanently redirects the directory to AI Personas", () => {
    LegacyCompanionsPage();

    expect(navigation.permanentRedirect).toHaveBeenCalledWith("/ai-personas");
  });

  it("permanently redirects persona profiles and preserves the supported tab", async () => {
    await LegacyCompanionProfilePage({
      params: Promise.resolve({ companionId: "moss" }),
      searchParams: Promise.resolve({ tab: "about" }),
    });

    expect(navigation.permanentRedirect).toHaveBeenCalledWith("/ai-personas/moss?tab=about");
  });
});
