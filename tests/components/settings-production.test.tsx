import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/client/api", () => ({
  apiRequest,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : "Request failed.",
  isPreviewMode: false,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
}));

import { SettingsPanel } from "@/components/settings/settings-panel";

describe("SettingsPanel production loading", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockImplementation((path: string) => {
      if (path === "/api/profile") return Promise.resolve({
        id: "user-1", username: "mina", display_name: "Mina", bio: null, avatar_url: null,
        profile_visibility: "private", daily_goal: 3, interests: ["Work"],
        default_task_visibility: "private", completion_visibility: "private", xp: 0,
        current_streak: 0, last_completion_date: null,
        created_at: "2026-08-14T12:00:00.000Z", updated_at: "2026-08-14T12:00:00.000Z",
      });
      if (path === "/api/notification-preferences") return Promise.resolve({ reactions: true, replies: true, companion_activity: true, email_digest: false });
      if (path === "/api/blocks") return Promise.reject(new Error("blocks unavailable"));
      if (path === "/api/companion-mutes") return Promise.resolve({ items: [] });
      return Promise.reject(new Error(`Unexpected path: ${path}`));
    });
  });

  it("keeps core settings usable when a safety list cannot load", async () => {
    render(<SettingsPanel />);

    expect(await screen.findByLabelText("Daily goal")).toHaveValue(3);
    expect(screen.getByText("Your settings loaded, but some safety lists could not be refreshed.")).toBeVisible();
  });
});
