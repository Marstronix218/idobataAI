import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterSummary } from "@idobata/contracts";

const { apiRequest, router } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  router: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/client/api", () => ({
  apiRequest,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : "Request failed.",
  isPreviewMode: false,
}));

import { PivotOnboarding } from "@/components/onboarding/pivot-onboarding";

const DISCLOSURE = "AI character · not a person · not a therapist, doctor or lawyer";
const characters: CharacterSummary[] = [
  { id: "c1000000-0000-4000-8000-000000000001", slug: "sample-coach", name: "Sample Coach", role: "coach", art_url: null, is_launch: true, pack_sku: null },
];

/** Pretends this device is set to `zone`. */
function deviceTimeZone(zone: string) {
  const real = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...real.call(this), timeZone: zone };
  });
}

beforeEach(() => {
  apiRequest.mockReset();
  apiRequest.mockResolvedValue({ selected_character_id: characters[0].id, timezone: null, age_verified_at: null });
  router.replace.mockReset();
  router.refresh.mockReset();
  // The runtime's ~400 zones make every axe pass take seconds.
  vi.spyOn(Intl, "supportedValuesOf").mockReturnValue(["America/Chicago", "Asia/Tokyo", "Europe/London"]);
});

describe("PivotOnboarding", () => {
  it("opens on meeting the characters, with the AI disclosure visible", async () => {
    const { container } = render(<PivotOnboarding characters={characters} />);

    expect(screen.getByRole("heading", { level: 1, name: "Pick your character" })).toBeVisible();
    expect(screen.getByLabelText("Step 1 of 2: Meet your character")).toBeInTheDocument();
    const disclosure = screen.getByRole("note", { name: "AI disclosure" });
    expect(disclosure).toBeVisible();
    expect(disclosure.textContent).toBe(DISCLOSURE);
    expect(screen.getByRole("button", { name: /Continue/ })).toBeDisabled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("saves the character, detects the time zone, saves it and goes to tasks", async () => {
    deviceTimeZone("America/Chicago");
    const { container } = render(<PivotOnboarding characters={characters} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose Sample Coach" }));

    const zone = await screen.findByLabelText("Time zone");
    expect(apiRequest).toHaveBeenNthCalledWith(1, "/api/coach/profile", { method: "PUT", body: JSON.stringify({ characterId: characters[0].id }) });
    expect(screen.getByRole("heading", { level: 1, name: "Confirm your time zone" })).toBeVisible();
    expect(zone).toHaveValue("America/Chicago");
    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(screen.getByRole("button", { name: /Save and continue/ }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/tasks"));
    expect(apiRequest).toHaveBeenNthCalledWith(2, "/api/coach/profile", { method: "PUT", body: JSON.stringify({ timezone: "America/Chicago" }) });
    expect(router.refresh).toHaveBeenCalled();
  });

  it("lets the user change the detected time zone before saving", async () => {
    deviceTimeZone("America/Chicago");
    render(<PivotOnboarding characters={characters} selectedCharacterId={characters[0].id} />);

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: "Europe/London" } });
    fireEvent.click(screen.getByRole("button", { name: /Save and continue/ }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/tasks"));
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledWith("/api/coach/profile", { method: "PUT", body: JSON.stringify({ timezone: "Europe/London" }) });
  });

  it("offers a zone the device reports even when the runtime's list leaves it out", async () => {
    deviceTimeZone("UTC");
    render(<PivotOnboarding characters={characters} selectedCharacterId={characters[0].id} />);

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    expect(screen.getByLabelText("Time zone")).toHaveValue("UTC");
  });

  it("prefers a time zone saved earlier over the detected one", () => {
    deviceTimeZone("America/Chicago");
    render(<PivotOnboarding characters={characters} selectedCharacterId={characters[0].id} savedTimezone="Asia/Tokyo" />);

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    expect(screen.getByLabelText("Time zone")).toHaveValue("Asia/Tokyo");
  });

  it("stays on the step and shows the error when saving fails", async () => {
    apiRequest.mockRejectedValue(new Error("Choose a valid time zone."));
    render(<PivotOnboarding characters={characters} selectedCharacterId={characters[0].id} />);

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(screen.getByRole("button", { name: /Save and continue/ }));

    expect(await screen.findByText("Choose a valid time zone.")).toBeVisible();
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Save and continue/ })).toBeEnabled();
  });
});
