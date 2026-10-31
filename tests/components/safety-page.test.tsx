import { render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEGACY_FLAGS, resolveFlags } from "@/lib/domain/feature-flags";

const { connection, getFlags, notFound } = vi.hoisted(() => ({
  connection: vi.fn(async () => undefined),
  getFlags: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); }),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: { claims: null } }) } }),
}));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection }));
vi.mock("next/navigation", () => ({ notFound, useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/flags", () => ({ getFlags }));

import { SettingsPanel } from "@/components/settings/settings-panel";
import PrivacyPage from "@/app/privacy/page";
import SafetyPage from "@/app/safety/page";
import { SAFETY_PLACEHOLDER_BANNER, SAFETY_PLACEHOLDER_MARKER } from "@/app/safety/placeholder";
import TermsPage from "@/app/terms/page";
import { proxy } from "@/proxy";

/** Written out, not imported, so a reworded disclosure fails here. */
const DISCLOSURE = "AI character · not a person · not a therapist, doctor or lawyer";
const PIVOT = resolveFlags({ "pivot_a.enabled": true });

const pivot = (enabled: boolean) => getFlags.mockResolvedValue(enabled ? PIVOT : LEGACY_FLAGS);
const renderSafety = async () => render(await SafetyPage());

beforeEach(() => {
  pivot(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/safety under Pivot A", () => {
  it("is unmistakably placeholder copy: a visible banner and a machine-readable marker", async () => {
    await renderSafety();

    expect(SAFETY_PLACEHOLDER_BANNER).toBe("Placeholder — pending counsel review");
    expect(SAFETY_PLACEHOLDER_MARKER).toBe("counsel-review");
    expect(screen.getByText("Placeholder — pending counsel review")).toBeVisible();
    expect(screen.getByRole("main")).toHaveAttribute("data-placeholder", "counsel-review");
  });

  it("renders per request, before reading the flags", async () => {
    await renderSafety();

    expect(connection).toHaveBeenCalled();
    expect(connection.mock.invocationCallOrder[0]).toBeLessThan(getFlags.mock.invocationCallOrder[0]);
  });

  it("shows the exact AI disclosure line", async () => {
    await renderSafety();

    expect(screen.getByRole("heading", { level: 1, name: "Safety" })).toBeVisible();
    expect(screen.getByText(DISCLOSURE)).toBeVisible();
  });

  it("offers the 988 Lifeline by call or text and 911 for immediate danger", async () => {
    await renderSafety();

    const help = screen.getByRole("region", { name: "Getting help" });
    expect(within(help).getByText(/988 Suicide & Crisis Lifeline/)).toBeVisible();
    expect(within(help).getByRole("link", { name: "call 988" })).toHaveAttribute("href", "tel:988");
    expect(within(help).getByRole("link", { name: "text 988" })).toHaveAttribute("href", "sms:988");
    expect(within(help).getByRole("link", { name: "call 911" })).toHaveAttribute("href", "tel:911");
    const distress = screen.getByRole("region", { name: "When task text suggests distress" });
    expect(distress).toHaveTextContent("988 Suicide & Crisis Lifeline (call or text 988) and 911 for immediate danger");
  });

  it("states the age rule without promising more than a date-of-birth check, and what is kept", async () => {
    const { container } = await renderSafety();

    expect(screen.getByRole("region", { name: "Adults only" }))
      .toHaveTextContent("The app asks for your date of birth at sign-up; you must be 18 or older to create an account.");
    expect(screen.getByRole("region", { name: "No open-ended chat" })).toBeVisible();
    const kept = screen.getByRole("region", { name: "What is kept" });
    expect(kept).toHaveTextContent("aggregate daily count of crisis cards shown");
    expect(kept).toHaveTextContent("no task text and no user id");
    // The 30-day reaction retention line waits for Phase 8's purge job.
    expect(container).not.toHaveTextContent(/30 days/);
  });

  it("has no automated accessibility violations", async () => {
    const { container } = await renderSafety();

    expect(await axe(container)).toHaveNoViolations();
  });

  it("is reachable without signing in", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_MODE", "false");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");

    const response = await proxy(new NextRequest("https://idobata.test/safety"));

    expect(response.headers.get("location")).toBeNull();
    expect(response.status).toBe(200);
  });

  it("is reachable without signing in when Supabase isn't configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_MODE", "false");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    const response = await proxy(new NextRequest("https://idobata.test/safety"));

    expect(response.headers.get("location")).toBeNull();
  });
});

describe("/safety with Pivot A off", () => {
  it("is not found", async () => {
    pivot(false);

    await expect(SafetyPage()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(notFound).toHaveBeenCalled();
  });
});

describe("links to /safety", () => {
  it.each([["privacy", PrivacyPage], ["terms", TermsPage]])("the %s page links to it under Pivot A only", async (_name, Page) => {
    const { unmount } = render(await Page());
    expect(screen.getByRole("link", { name: "How safety works" })).toHaveAttribute("href", "/safety");
    unmount();

    pivot(false);
    render(await Page());
    expect(screen.queryByRole("link", { name: "How safety works" })).not.toBeInTheDocument();
  });

  it("the settings safety section links to it under Pivot A only", () => {
    const { container, unmount } = render(<SettingsPanel flags={PIVOT} />);
    const section = container.querySelector("section#safety") as HTMLElement;
    expect(within(section).getByRole("link", { name: "How safety works" })).toHaveAttribute("href", "/safety");
    unmount();

    render(<SettingsPanel />);
    expect(screen.queryByRole("link", { name: "How safety works" })).not.toBeInTheDocument();
  });
});
