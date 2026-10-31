import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterSummary } from "@idobata/contracts";

const { apiRequest, router, signOut } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  router: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
  signOut: vi.fn(),
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
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut } }) }));

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
    const { container } = render(<PivotOnboarding characters={characters} ageVerified />);

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
    const { container } = render(<PivotOnboarding characters={characters} ageVerified />);

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
    render(<PivotOnboarding characters={characters} ageVerified selectedCharacterId={characters[0].id} />);

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: "Europe/London" } });
    fireEvent.click(screen.getByRole("button", { name: /Save and continue/ }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/tasks"));
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledWith("/api/coach/profile", { method: "PUT", body: JSON.stringify({ timezone: "Europe/London" }) });
  });

  it("offers a zone the device reports even when the runtime's list leaves it out", async () => {
    deviceTimeZone("UTC");
    render(<PivotOnboarding characters={characters} ageVerified selectedCharacterId={characters[0].id} />);

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    expect(screen.getByLabelText("Time zone")).toHaveValue("UTC");
  });

  it("prefers a time zone saved earlier over the detected one", () => {
    deviceTimeZone("America/Chicago");
    render(<PivotOnboarding characters={characters} ageVerified selectedCharacterId={characters[0].id} savedTimezone="Asia/Tokyo" />);

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    expect(screen.getByLabelText("Time zone")).toHaveValue("Asia/Tokyo");
  });

  it("stays on the step and shows the error when saving fails", async () => {
    apiRequest.mockRejectedValue(new Error("Choose a valid time zone."));
    render(<PivotOnboarding characters={characters} ageVerified selectedCharacterId={characters[0].id} />);

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(screen.getByRole("button", { name: /Save and continue/ }));

    expect(await screen.findByText("Choose a valid time zone.")).toBeVisible();
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Save and continue/ })).toBeEnabled();
  });
});

describe("PivotOnboarding age step (accounts from before the age gate)", () => {
  /** An API failure as apiRequest throws it. */
  const apiFailure = (code: string, message: string) => Object.assign(new Error(message), { code });

  beforeEach(() => {
    signOut.mockReset();
    signOut.mockResolvedValue({ error: null });
    deviceTimeZone("America/Chicago");
  });

  it("comes first when the age is not verified, before anything is saved", async () => {
    const { container } = render(<PivotOnboarding characters={characters} ageVerified={false} />);

    expect(screen.getByLabelText("Step 1 of 3: Confirm your age")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "What’s your date of birth?" })).toBeVisible();
    expect(screen.getByLabelText("Date of birth")).toHaveAttribute("type", "date");
    expect(screen.queryByRole("button", { name: /Choose Sample Coach/ })).not.toBeInTheDocument();
    expect(apiRequest).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("offers sign-out and Settings on the age step, so nobody is stuck there", async () => {
    render(<PivotOnboarding characters={characters} ageVerified={false} />);

    const exits = screen.getByRole("navigation", { name: "Account" });
    expect(within(exits).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings#safety");

    fireEvent.click(within(exits).getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("keeps the exits and explains when age verification is unavailable (503)", async () => {
    apiRequest.mockRejectedValue(apiFailure("age_verification_unavailable", "Age verification is not available right now. Please try again later."));
    render(<PivotOnboarding characters={characters} ageVerified={false} />);

    fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value: "1990-05-17" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    expect(await screen.findByText("Age verification is not available right now. Please try again later.")).toBeVisible();
    const exits = screen.getByRole("navigation", { name: "Account" });
    expect(within(exits).getByRole("button", { name: "Sign out" })).toBeEnabled();
    expect(within(exits).getByRole("link", { name: "Settings" })).toBeVisible();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("keeps the exits on the later steps too", async () => {
    render(<PivotOnboarding characters={characters} ageVerified={false} />);

    fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value: "1990-05-17" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    await screen.findByRole("heading", { level: 1, name: "Pick your character" });
    expect(within(screen.getByRole("navigation", { name: "Account" })).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings#safety");
  });

  // A failed read of the cast can land a verified user on an empty character step.
  it("lets a verified user stuck on an empty character step sign out or open Settings", async () => {
    render(<PivotOnboarding characters={[]} ageVerified />);

    expect(screen.getByRole("heading", { level: 1, name: "Pick your character" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Continue/ })).toBeDisabled();
    const exits = screen.getByRole("navigation", { name: "Account" });
    expect(within(exits).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings#safety");

    fireEvent.click(within(exits).getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("is skipped when the age is already verified", () => {
    render(<PivotOnboarding characters={characters} ageVerified />);

    expect(screen.queryByLabelText("Date of birth")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Step 1 of 2: Meet your character")).toBeInTheDocument();
  });

  it("asks for a date before calling the server", () => {
    render(<PivotOnboarding characters={characters} ageVerified={false} />);

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    expect(screen.getByText("Enter your date of birth.")).toBeVisible();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("verifies the age, then meets the characters, and never offers the age step again", async () => {
    render(<PivotOnboarding characters={characters} ageVerified={false} />);

    fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value: "1990-05-17" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    expect(await screen.findByRole("heading", { level: 1, name: "Pick your character" })).toBeVisible();
    expect(apiRequest).toHaveBeenCalledWith("/api/coach/age", { method: "POST", body: JSON.stringify({ dateOfBirth: "1990-05-17", timeZone: "America/Chicago" }) });
    expect(screen.getByLabelText("Step 2 of 3: Meet your character")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back/ })).toBeDisabled();
    expect(screen.getByRole("note", { name: "AI disclosure" }).textContent).toBe(DISCLOSURE);
  });

  it("goes straight to tasks when the rest of the profile was saved before the age gate", async () => {
    render(<PivotOnboarding characters={characters} ageVerified={false} selectedCharacterId={characters[0].id} savedTimezone="America/Chicago" />);

    fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value: "1990-05-17" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/tasks"));
    expect(router.refresh).toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("goes straight to tasks when there is no character to choose", async () => {
    render(<PivotOnboarding characters={[]} ageVerified={false} />);

    fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value: "1990-05-17" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/tasks"));
  });

  it("shows the server's message for an invalid date and stays on the step", async () => {
    apiRequest.mockRejectedValue(apiFailure("invalid_date_of_birth", "Enter your real date of birth."));
    render(<PivotOnboarding characters={characters} ageVerified={false} />);

    fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value: "2099-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    expect(await screen.findByText("Enter your real date of birth.")).toBeVisible();
    expect(screen.getByLabelText("Date of birth")).toBeEnabled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("closes the app for an under-18 result, offering sign-out and account deletion only", async () => {
    apiRequest.mockRejectedValue(apiFailure("age_requirement", "You need to be 18 or older to use idobata."));
    const { container } = render(<PivotOnboarding characters={characters} ageVerified={false} />);

    fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value: "2012-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("You need to be 18 or older to use idobata.");
    expect(screen.getByRole("link", { name: "Delete my account" })).toHaveAttribute("href", "/settings#safety");
    expect(screen.queryByLabelText("Date of birth")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Continue/ })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });
});
