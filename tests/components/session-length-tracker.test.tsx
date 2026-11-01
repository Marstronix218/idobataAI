import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AuthListener = (event: string, session: { access_token: string } | null) => void;

const { auth, state } = vi.hoisted(() => ({
  state: { listener: null as AuthListener | null, session: { access_token: "token-1" } as { access_token: string } | null },
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    unsubscribe: vi.fn(),
  },
}));

vi.mock("@/lib/client/api", () => ({ isPreviewMode: false }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: auth.getSession, onAuthStateChange: auth.onAuthStateChange } }),
}));

import { SESSION_LENGTH_PATH, SessionLengthTracker } from "@/components/analytics/session-length-tracker";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
let visibility: DocumentVisibilityState = "visible";
const fetchMock = vi.fn();

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
}
const pageHide = () => act(() => { window.dispatchEvent(new Event("pagehide")); });
const advance = (ms: number) => act(() => { vi.setSystemTime(Date.now() + ms); });

/** Renders the tracker and lets the cached token arrive. */
async function mount() {
  const view = render(<SessionLengthTracker />);
  await act(async () => { await Promise.resolve(); });
  return view;
}

const sent = () => fetchMock.mock.calls.map(([path, init]) => ({ path, init: init as RequestInit & { keepalive?: boolean } }));
const sentSeconds = () => sent().map(({ init }) => JSON.parse(String(init.body)).durationSeconds as number);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T09:00:00Z"));
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  state.session = { access_token: "token-1" };
  state.listener = null;
  auth.getSession.mockImplementation(async () => ({ data: { session: state.session }, error: null }));
  auth.onAuthStateChange.mockImplementation((listener: AuthListener) => {
    state.listener = listener;
    return { data: { subscription: { unsubscribe: auth.unsubscribe } } };
  });
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SessionLengthTracker", () => {
  it("sends the foreground seconds once when the page is hidden, with keepalive and the bearer token", async () => {
    await mount();
    advance(90 * SECOND);

    setVisibility("hidden");
    // Closing the tab fires pagehide right after: nothing more to send.
    pageHide();

    expect(sent()).toHaveLength(1);
    const [{ path, init }] = sent();
    expect(path).toBe(SESSION_LENGTH_PATH);
    expect(init).toMatchObject({ method: "POST", keepalive: true });
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer token-1");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    // Seconds and nothing else: no page, task or time of day.
    expect(JSON.parse(String(init.body))).toEqual({ durationSeconds: 90 });
  });

  it("counts foreground time only: hidden time never adds up", async () => {
    await mount();
    advance(60 * SECOND);
    setVisibility("hidden");
    advance(10 * MINUTE);
    setVisibility("visible");
    advance(30 * SECOND);
    pageHide();

    expect(sentSeconds()).toEqual([60, 30]);
  });

  it("starts counting only once a page that loads hidden becomes visible", async () => {
    visibility = "hidden";
    await mount();
    advance(5 * MINUTE);
    setVisibility("visible");
    advance(45 * SECOND);
    setVisibility("hidden");

    expect(sentSeconds()).toEqual([45]);
  });

  it("sends nothing for a stretch under a second, and clamps a very long one to a day", async () => {
    await mount();
    advance(400);
    setVisibility("hidden");
    expect(fetchMock).not.toHaveBeenCalled();

    setVisibility("visible");
    advance(3 * 86_400 * SECOND);
    setVisibility("hidden");
    expect(sentSeconds()).toEqual([86_400]);
  });

  it("uses the refreshed token, and sends nothing once signed out", async () => {
    await mount();
    act(() => state.listener?.("TOKEN_REFRESHED", { access_token: "token-2" }));
    advance(20 * SECOND);
    setVisibility("hidden");
    expect(new Headers(sent()[0].init.headers).get("authorization")).toBe("Bearer token-2");

    act(() => state.listener?.("SIGNED_OUT", null));
    setVisibility("visible");
    advance(20 * SECOND);
    setVisibility("hidden");
    expect(sent()).toHaveLength(1);
  });

  it("sends the running stretch when it leaves the app shell, and stops listening", async () => {
    const view = await mount();
    advance(42 * SECOND);

    view.unmount();
    setVisibility("hidden");

    expect(sentSeconds()).toEqual([42]);
    expect(auth.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("never throws when the request fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    await mount();
    advance(10 * SECOND);

    expect(() => setVisibility("hidden")).not.toThrow();
    await act(async () => { await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
