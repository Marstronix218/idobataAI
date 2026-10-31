import { render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFlags } from "@/lib/domain/feature-flags";

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

describe("SettingsPanel under the Pivot A flags", () => {
  beforeEach(() => {
    // Pivot A adds a time zone picker; the runtime's ~400 zones make axe slow.
    vi.spyOn(Intl, "supportedValuesOf").mockReturnValue(["America/Chicago", "Europe/London"]);
    apiRequest.mockReset();
    apiRequest.mockImplementation((path: string) => {
      if (path === "/api/profile") return Promise.resolve({
        id: "user-1", username: "mina", display_name: "Mina", bio: null, avatar_url: null,
        profile_visibility: "private", daily_goal: 3, interests: ["Work"],
        default_task_visibility: "private", completion_visibility: "private", xp: 0,
        current_streak: 0, last_completion_date: null,
        created_at: "2026-11-01T12:00:00.000Z", updated_at: "2026-11-01T12:00:00.000Z",
      });
      if (path === "/api/notification-preferences") return Promise.resolve({ reactions: true, replies: true, companion_activity: true });
      if (path === "/api/blocks") return Promise.resolve({ items: [{ id: "user-2", name: "Casey Park", username: "casey", avatarUrl: null }] });
      if (path === "/api/companion-mutes") return Promise.resolve({ items: [{ id: "orbit", name: "Orbit", slug: "orbit", avatarUrl: null }] });
      if (path === "/api/coach/profile") return Promise.resolve({ selected_character_id: null, timezone: null, age_verified_at: null });
      if (path === "/api/characters") return Promise.resolve({ items: [] });
      return Promise.reject(new Error(`Unexpected path: ${path}`));
    });
  });

  it("hides persona and social controls under a default Pivot A and keeps account, privacy and safety", async () => {
    const { container } = render(<SettingsPanel flags={resolveFlags({ "pivot_a.enabled": true })} />);

    expect(await screen.findByLabelText("Daily goal")).toHaveValue(3);
    expect(await screen.findByRole("list", { name: "Blocked people" })).toHaveTextContent("Casey Park");
    expect(screen.getByLabelText("Who can see posted task completions?")).toBeInTheDocument();
    expect(screen.getByText("This applies when you press Post after completing a task.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete account/ })).toBeVisible();

    expect(screen.queryByText(/AI accounts remain active/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Muted AI companions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Notifications" })).not.toBeInTheDocument();
    const sections = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(sections).getAllByRole("link").map((link) => link.textContent)).toEqual(["Preferences", "Privacy", "Character", "Feedback", "About", "Safety"]);
    expect(apiRequest).not.toHaveBeenCalledWith("/api/companion-mutes", expect.anything());
    expect(screen.queryByText(/some safety lists could not be refreshed/)).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("keeps people's notifications but not AI follower activity when the social feed is on under Pivot A", async () => {
    render(<SettingsPanel flags={resolveFlags({ "pivot_a.enabled": true, "social_feed.enabled": true })} />);

    expect(await screen.findByRole("heading", { name: "Notifications" })).toBeVisible();
    expect(screen.getByRole("switch", { name: "Likes and reposts" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Replies and quotes" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "AI follower activity" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Muted AI companions" })).not.toBeInTheDocument();
  });

  it("shows everything with today's flags", async () => {
    render(<SettingsPanel />);

    expect(await screen.findByRole("list", { name: "Muted AI companions" })).toHaveTextContent("Orbit");
    expect(screen.getByRole("switch", { name: "AI follower activity" })).toBeInTheDocument();
    expect(screen.getByText(/AI accounts remain active/)).toBeInTheDocument();
    expect(apiRequest).toHaveBeenCalledWith("/api/companion-mutes", expect.anything());
  });
});
