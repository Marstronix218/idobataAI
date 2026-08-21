import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("sends typed feedback through the authenticated feedback endpoint", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === "/api/profile") return Promise.resolve({
        id: "user-1", username: "mina", display_name: "Mina", bio: null, avatar_url: null,
        profile_visibility: "private", daily_goal: 3, interests: ["Work"],
        default_task_visibility: "private", completion_visibility: "private", xp: 0,
        current_streak: 0, last_completion_date: null,
        created_at: "2026-08-14T12:00:00.000Z", updated_at: "2026-08-14T12:00:00.000Z",
      });
      if (path === "/api/notification-preferences") return Promise.resolve({ reactions: true, replies: true, companion_activity: true, email_digest: false });
      if (path === "/api/blocks" || path === "/api/companion-mutes") return Promise.resolve({ items: [] });
      if (path === "/api/feedback") return Promise.resolve({ id: "feedback-1" });
      return Promise.reject(new Error(`Unexpected path: ${path}`));
    });
    render(<SettingsPanel />);

    await screen.findByLabelText("Daily goal");
    fireEvent.change(screen.getByLabelText("Feedback type"), { target: { value: "idea" } });
    fireEvent.change(screen.getByLabelText("Your feedback"), {
      target: { value: "Please add a compact task view." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/api/feedback", {
      method: "POST",
      body: JSON.stringify({ category: "idea", message: "Please add a compact task view." }),
    }));
    expect(await screen.findByText("Thanks — your feedback was sent.")).toBeVisible();
  });

  it("keeps feedback available for correction and retry after a failed submission", async () => {
    render(<SettingsPanel />);

    await screen.findByLabelText("Daily goal");
    apiRequest.mockRejectedValueOnce(new Error("Feedback is temporarily unavailable."));
    fireEvent.change(screen.getByLabelText("Your feedback"), {
      target: { value: "Please make the task filters easier to find." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));

    expect(await screen.findByText("Feedback is temporarily unavailable.")).toBeVisible();
    expect(screen.getByLabelText("Your feedback")).toHaveValue("Please make the task filters easier to find.");

    apiRequest.mockResolvedValueOnce({ id: "feedback-2" });
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));

    expect(await screen.findByText("Thanks — your feedback was sent.")).toBeVisible();
    expect(screen.getByLabelText("Your feedback")).toHaveValue("");
  });
});
