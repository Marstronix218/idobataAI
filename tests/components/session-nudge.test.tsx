import { act, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("@/lib/client/api", () => ({ apiRequest, errorMessage: () => "Request failed.", isPreviewMode: false }));

import { SESSION_STORAGE_KEY, SessionNudge } from "@/components/coach/session-nudge";

const MINUTE = 60_000;
const character = { id: "c1000000-0000-4000-8000-000000000001", slug: "sample-coach", name: "Sample Coach", artUrl: null };
const line = { text: "That's plenty for now. Go do the thing.", character, disclosure: null };
const DISCLOSURE = "AI character · not a person · not a therapist, doctor or lawyer";

let visibility: DocumentVisibilityState = "visible";

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
}

/** Advances fake time and lets the nudge request settle. */
async function wait(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

const nudgeRequests = () => apiRequest.mock.calls.filter(([path]) => path === "/api/coach/nudge").length;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-10-31T09:00:00Z"));
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  window.sessionStorage.clear();
  apiRequest.mockReset();
  apiRequest.mockResolvedValue(line);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SessionNudge", () => {
  it("shows the character's line after 10 minutes of foreground time", async () => {
    const { container } = render(<SessionNudge />);

    await wait(10 * MINUTE - 1);
    expect(nudgeRequests()).toBe(0);
    expect(screen.queryByText(line.text)).not.toBeInTheDocument();

    await wait(1);

    expect(nudgeRequests()).toBe(1);
    expect(screen.getByText(line.text)).toBeVisible();
    expect(screen.getByText("Sample Coach")).toBeVisible();
    expect(screen.getByText(line.text).closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
    // A gentle note: no dialog, nothing that takes focus.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(document.body).toHaveFocus();
    vi.useRealTimers();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("does not count hidden time", async () => {
    render(<SessionNudge />);

    await wait(6 * MINUTE);
    setVisibility("hidden");
    await wait(20 * MINUTE);
    setVisibility("visible");
    await wait(4 * MINUTE - 1);
    expect(nudgeRequests()).toBe(0);

    await wait(1);

    expect(nudgeRequests()).toBe(1);
    expect(screen.getByText(line.text)).toBeVisible();
  });

  it("does not count time while it mounts in a hidden tab", async () => {
    visibility = "hidden";
    render(<SessionNudge />);

    await wait(15 * MINUTE);
    expect(nudgeRequests()).toBe(0);

    setVisibility("visible");
    await wait(10 * MINUTE);

    expect(nudgeRequests()).toBe(1);
  });

  it("starts a new session after at least 30 minutes hidden", async () => {
    render(<SessionNudge />);

    await wait(9 * MINUTE);
    setVisibility("hidden");
    await wait(30 * MINUTE);
    setVisibility("visible");
    await wait(9 * MINUTE);
    expect(nudgeRequests()).toBe(0);

    await wait(1 * MINUTE);

    expect(nudgeRequests()).toBe(1);
  });

  it("keeps the session through a hidden gap just under 30 minutes", async () => {
    render(<SessionNudge />);

    await wait(9 * MINUTE);
    setVisibility("hidden");
    await wait(30 * MINUTE - 1);
    setVisibility("visible");
    await wait(1 * MINUTE);

    expect(nudgeRequests()).toBe(1);
  });

  it("shows at most once per session, after a dismissal or a reload", async () => {
    const { unmount } = render(<SessionNudge />);

    await wait(10 * MINUTE);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(line.text)).not.toBeInTheDocument();

    await wait(60 * MINUTE);
    setVisibility("hidden");
    await wait(5 * MINUTE);
    setVisibility("visible");
    await wait(60 * MINUTE);
    unmount();
    // A reload in the same tab carries the session over.
    render(<SessionNudge />);
    await wait(60 * MINUTE);

    expect(nudgeRequests()).toBe(1);
    expect(screen.queryByText(line.text)).not.toBeInTheDocument();
  });

  it("shows the AI reminder when it is the character's first line of the day", async () => {
    apiRequest.mockResolvedValue({ ...line, disclosure: DISCLOSURE });
    const { container } = render(<SessionNudge />);

    await wait(10 * MINUTE);

    expect(screen.getByText(line.text)).toBeVisible();
    expect(screen.getByRole("note", { name: "AI disclosure" }).textContent).toBe(DISCLOSURE);
    vi.useRealTimers();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("leaves the AI reminder out when the line carries none", async () => {
    render(<SessionNudge />);

    await wait(10 * MINUTE);

    expect(screen.getByText(line.text)).toBeVisible();
    expect(screen.queryByRole("note", { name: "AI disclosure" })).not.toBeInTheDocument();
  });

  it("banks foreground time on pagehide, so a real reload keeps it", async () => {
    const { unmount } = render(<SessionNudge />);

    await wait(7 * MINUTE);
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    expect(JSON.parse(window.sessionStorage.getItem(SESSION_STORAGE_KEY)!)).toMatchObject({ foregroundMs: 7 * MINUTE, fetched: false });

    // A real unload runs no React cleanup: keep only what pagehide stored.
    const stored = window.sessionStorage.getItem(SESSION_STORAGE_KEY)!;
    unmount();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, stored);
    render(<SessionNudge />);
    await wait(3 * MINUTE - 1);
    expect(nudgeRequests()).toBe(0);

    await wait(1);

    expect(nudgeRequests()).toBe(1);
  });

  it("keeps counting after a pagehide the page comes back from", async () => {
    render(<SessionNudge />);

    await wait(4 * MINUTE);
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    await wait(6 * MINUTE);

    expect(nudgeRequests()).toBe(1);
  });

  it("carries foreground time across a reload in the same tab", async () => {
    const { unmount } = render(<SessionNudge />);

    await wait(7 * MINUTE);
    unmount();
    render(<SessionNudge />);
    await wait(3 * MINUTE);

    expect(nudgeRequests()).toBe(1);
  });

  it.each([
    ["the server has no line", () => apiRequest.mockResolvedValue(null)],
    ["the request fails", () => apiRequest.mockRejectedValue(new Error("Raw server message"))],
  ])("shows nothing and never asks again when %s", async (_name, arrange) => {
    arrange();
    const { container } = render(<SessionNudge />);

    await wait(10 * MINUTE);
    await wait(60 * MINUTE);

    expect(nudgeRequests()).toBe(1);
    expect(container.querySelector("[aria-live]")).toBeEmptyDOMElement();
    expect(screen.queryByText("Raw server message")).not.toBeInTheDocument();
  });

  it("works when sessionStorage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<SessionNudge />);

    await wait(5 * MINUTE);
    setVisibility("hidden");
    await wait(MINUTE);
    setVisibility("visible");
    await wait(5 * MINUTE);

    expect(nudgeRequests()).toBe(1);
    expect(screen.getByText(line.text)).toBeVisible();
  });

  it("ignores a stored session older than the 30-minute gap", async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ foregroundMs: 9 * MINUTE, fetched: true, savedAt: Date.now() - 31 * MINUTE }));
    render(<SessionNudge />);

    await wait(10 * MINUTE);

    expect(nudgeRequests()).toBe(1);
  });
});
