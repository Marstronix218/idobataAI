import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFlags } from "@/lib/domain/feature-flags";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a>,
}));
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

const coach = { id: "c1000000-0000-4000-8000-000000000001", slug: "sample-coach", name: "Sample Coach", role: "coach", art_url: null, is_launch: true, pack_sku: null };
const rival = { id: "c1000000-0000-4000-8000-000000000002", slug: "pack-rival", name: "Pack Rival", role: "rival", art_url: null, is_launch: false, pack_sku: "pack_rival" };

function serve(coachProfile = { selected_character_id: coach.id, timezone: "America/Chicago", age_verified_at: null }) {
  apiRequest.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/api/profile") return Promise.resolve({
      id: "user-1", username: "mina", display_name: "Mina", bio: null, avatar_url: null,
      profile_visibility: "private", daily_goal: 3, interests: [],
      default_task_visibility: "private", completion_visibility: "private", xp: 0,
      current_streak: 0, last_completion_date: null,
      created_at: "2026-10-31T12:00:00.000Z", updated_at: "2026-10-31T12:00:00.000Z",
    });
    if (path === "/api/notification-preferences") return Promise.resolve({ reactions: true, replies: true, companion_activity: true });
    if (path === "/api/blocks") return Promise.resolve({ items: [] });
    if (path === "/api/coach/profile" && init?.method === "PUT") return Promise.resolve({ ...coachProfile, ...renamed(JSON.parse(String(init.body))) });
    if (path === "/api/coach/profile") return Promise.resolve(coachProfile);
    if (path === "/api/characters") return Promise.resolve({ items: [coach, rival] });
    return Promise.reject(new Error(`Unexpected path: ${path}`));
  });
}

function renamed(body: { characterId?: string; timezone?: string }) {
  return { ...(body.characterId && { selected_character_id: body.characterId }), ...(body.timezone && { timezone: body.timezone }) };
}

const PIVOT = resolveFlags({ "pivot_a.enabled": true });

beforeEach(() => {
  apiRequest.mockReset();
  serve();
  // The runtime's ~400 zones make every axe pass take seconds.
  vi.spyOn(Intl, "supportedValuesOf").mockReturnValue(["America/Chicago", "Asia/Tokyo", "Europe/London"]);
});

describe("SettingsPanel character section", () => {
  it("shows the saved character and time zone under Pivot A", async () => {
    const { container } = render(<SettingsPanel flags={PIVOT} />);

    const section = (await screen.findByRole("heading", { name: "Your character" })).closest("section")!;
    expect(await within(section).findByLabelText("Character")).toHaveValue(coach.id);
    expect(within(section).getByLabelText("Time zone")).toHaveValue("America/Chicago");
    expect(within(section).getByRole("link", { name: "View Sample Coach’s profile" })).toHaveAttribute("href", "/characters/sample-coach");
    expect(within(section).getByRole("option", { name: "Pack Rival · Rival" })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Save character and time zone" })).toBeDisabled();
    // Choosing someone new here is a first meeting too.
    expect(within(section).getByRole("note", { name: "AI disclosure" }).textContent).toBe("AI character · not a person · not a therapist, doctor or lawyer");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows a saved character that can no longer be chosen as unavailable, not as another character", async () => {
    const retiredId = "c1000000-0000-4000-8000-0000000000ff";
    serve({ selected_character_id: retiredId, timezone: "America/Chicago", age_verified_at: null });
    const { container } = render(<SettingsPanel flags={PIVOT} />);
    const section = (await screen.findByRole("heading", { name: "Your character" })).closest("section")!;

    const select = await within(section).findByLabelText("Character");
    expect(select).toHaveValue(retiredId);
    const unavailable = within(section).getByRole("option", { name: "No longer available" });
    expect(unavailable).toBeDisabled();
    expect((unavailable as HTMLOptionElement).selected).toBe(true);
    expect(within(section).queryByRole("link", { name: /profile/ })).not.toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Save character and time zone" })).toBeDisabled();

    // A time zone change alone never resends the unavailable character.
    fireEvent.change(within(section).getByLabelText("Time zone"), { target: { value: "Asia/Tokyo" } });
    fireEvent.click(within(section).getByRole("button", { name: "Save character and time zone" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/api/coach/profile", { method: "PUT", body: JSON.stringify({ timezone: "Asia/Tokyo" }) }));
    expect(await axe(container)).toHaveNoViolations();
  });

  it("saves only what changed", async () => {
    render(<SettingsPanel flags={PIVOT} />);
    const section = (await screen.findByRole("heading", { name: "Your character" })).closest("section")!;

    fireEvent.change(await within(section).findByLabelText("Time zone"), { target: { value: "Europe/London" } });
    fireEvent.click(within(section).getByRole("button", { name: "Save character and time zone" }));

    await waitFor(() => expect(within(section).getByText("Saved.")).toBeVisible());
    expect(apiRequest).toHaveBeenCalledWith("/api/coach/profile", { method: "PUT", body: JSON.stringify({ timezone: "Europe/London" }) });

    fireEvent.change(within(section).getByLabelText("Character"), { target: { value: rival.id } });
    fireEvent.click(within(section).getByRole("button", { name: "Save character and time zone" }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/api/coach/profile", { method: "PUT", body: JSON.stringify({ characterId: rival.id }) }));
    expect(await within(section).findByRole("link", { name: "View Pack Rival’s profile" })).toHaveAttribute("href", "/characters/pack-rival");
  });

  it("shows the error when saving fails", async () => {
    render(<SettingsPanel flags={PIVOT} />);
    const section = (await screen.findByRole("heading", { name: "Your character" })).closest("section")!;
    apiRequest.mockRejectedValueOnce(new Error("That character is not available."));

    fireEvent.change(await within(section).findByLabelText("Character"), { target: { value: rival.id } });
    fireEvent.click(within(section).getByRole("button", { name: "Save character and time zone" }));

    expect(await within(section).findByText("That character is not available.")).toBeVisible();
  });

  it("is absent, and never calls the coach routes, while Pivot A is off", async () => {
    render(<SettingsPanel />);

    expect(await screen.findByLabelText("Daily goal")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your character" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Settings sections" })).queryByRole("link", { name: "Character" })).not.toBeInTheDocument();
    expect(apiRequest).not.toHaveBeenCalledWith("/api/coach/profile", expect.anything());
    expect(apiRequest).not.toHaveBeenCalledWith("/api/characters", expect.anything());
  });
});
