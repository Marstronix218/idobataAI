import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFlags } from "@/lib/domain/feature-flags";

const { connection, createClient, getConsistencySummary, getFlags, redirect, request } = vi.hoisted(() => ({
  connection: vi.fn(async () => undefined),
  createClient: vi.fn(),
  getConsistencySummary: vi.fn(),
  getFlags: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT;${path}`); }),
  // The pathname src/proxy.ts forwards to the layout.
  request: { pathname: "/tasks" as string | null },
}));

vi.mock("@/lib/flags", () => ({ getFlags }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/coach/consistency", () => ({ getConsistencySummary }));
vi.mock("next/navigation", () => ({ redirect, notFound: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(request.pathname === null ? {} : { "x-idobata-pathname": request.pathname }),
}));
vi.mock("@/components/layout/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/onboarding/onboarding-flow", () => ({ OnboardingFlow: () => null }));
vi.mock("@/components/onboarding/pivot-onboarding", () => ({ PivotOnboarding: () => null }));
vi.mock("@/components/tasks/task-board", () => ({ TaskBoard: () => null }));
vi.mock("@/components/layout/app-tab-layout", () => ({ AppTabLayout: ({ children }: { children: React.ReactNode }) => children }));

import { GET as home } from "@/app/home/route";
import AuthenticatedLayout from "@/app/(app)/layout";
import OnboardingPage from "@/app/onboarding/page";
import TasksPage from "@/app/(app)/tasks/page";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { PivotOnboarding } from "@/components/onboarding/pivot-onboarding";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const characterId = "c1000000-0000-4000-8000-000000000001";
const PIVOT = resolveFlags({ "pivot_a.enabled": true });
const LEGACY = resolveFlags({});

type Row = { selected_character_id: string | null; timezone: string | null; age_verified_at: string | null } | null;

const launchCharacter = { id: characterId, slug: "sample-coach", name: "Sample Coach", role: "coach", art_url: null, is_launch: true, pack_sku: null };

/**
 * A server Supabase client with a fixed user, coach profile row and cast.
 * `cast` is what the characters table returns; the default is one launch character.
 */
function useSession({
  user = { id: userId } as { id: string } | null,
  row = null as Row,
  error = null as { code: string; message: string } | null,
  cast = [launchCharacter] as object[],
} = {}) {
  const chain = (list: unknown[], single: { data: unknown; error: unknown }) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      like: vi.fn(() => query),
      in: vi.fn(() => query),
      order: vi.fn(() => query),
      maybeSingle: vi.fn(() => Promise.resolve(single)),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: list, error: null }).then(resolve),
    };
    return query;
  };
  const tables: Record<string, ReturnType<typeof chain>> = {
    user_coach_profiles: chain([], { data: row, error }),
    characters: chain(cast, { data: null, error: null }),
    entitlements: chain([], { data: null, error: null }),
  };
  const client = { auth: { getUser: vi.fn(async () => ({ data: { user } })) }, from: vi.fn((table: string) => tables[table]) };
  createClient.mockResolvedValue(client);
  return client;
}

const complete: Row = { selected_character_id: characterId, timezone: "America/Chicago", age_verified_at: null };

async function landing() {
  const response = await home(new NextRequest("https://idobata.test/home"));
  expect(response.status).toBe(307);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  return response.headers.get("location");
}

beforeEach(() => {
  vi.clearAllMocks();
  getConsistencySummary.mockResolvedValue({ totalDays: 4, characterDays: 2 });
  request.pathname = "/tasks";
  vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_MODE", "false");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
});

describe("GET /home", () => {
  it("keeps today's landing on the feed while Pivot A is off, without reading the profile", async () => {
    getFlags.mockResolvedValue(LEGACY);
    const client = useSession({ row: null });

    expect(await landing()).toBe("https://idobata.test/feed");
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each([
    ["no coach profile yet", null, "/onboarding"],
    ["a character but no time zone", { ...complete, timezone: null }, "/onboarding"],
    ["a time zone but no character", { ...complete, selected_character_id: null }, "/onboarding"],
    ["a character and a time zone", complete, "/tasks"],
  ] satisfies Array<[string, Row, string]>)("under Pivot A with %s goes to %s", async (_name, row, destination) => {
    getFlags.mockResolvedValue(PIVOT);
    const client = useSession({ row });

    expect(await landing()).toBe(`https://idobata.test${destination}`);
    expect(client.from).toHaveBeenCalledWith("user_coach_profiles");
  });

  it.each([
    ["no coach profile yet", null, "/tasks"],
    ["a time zone but no character", { ...complete, selected_character_id: null }, "/tasks"],
    // The time zone step needs no cast, so onboarding can still finish.
    ["a character but no time zone", { ...complete, timezone: null }, "/onboarding"],
  ] satisfies Array<[string, Row, string]>)("under Pivot A with an empty cast and %s goes to %s", async (_name, row, destination) => {
    getFlags.mockResolvedValue(PIVOT);
    useSession({ row, cast: [] });

    expect(await landing()).toBe(`https://idobata.test${destination}`);
  });

  it("goes to tasks when the profile cannot be read, where the layout checks again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getFlags.mockResolvedValue(PIVOT);
    useSession({ error: { code: "XX999", message: "boom" } });

    expect(await landing()).toBe("https://idobata.test/tasks");
  });

  it("sends a signed-out visitor to log in under Pivot A", async () => {
    getFlags.mockResolvedValue(PIVOT);
    useSession({ user: null });

    expect(await landing()).toBe("https://idobata.test/login?next=%2Fhome");
  });
});

describe("the app layout under Pivot A", () => {
  const children = <p>Tasks</p>;

  it("sends a user without a character or time zone to onboarding", async () => {
    getFlags.mockResolvedValue(PIVOT);
    useSession({ row: { ...complete, timezone: null } });

    await expect(AuthenticatedLayout({ children })).rejects.toThrow("NEXT_REDIRECT;/onboarding");
  });

  it("sends a user with no character to onboarding when there is one to choose", async () => {
    getFlags.mockResolvedValue(PIVOT);
    useSession({ row: null });

    await expect(AuthenticatedLayout({ children })).rejects.toThrow("NEXT_REDIRECT;/onboarding");
  });

  it("lets a user with no character in when the cast is empty, rather than locking them out", async () => {
    getFlags.mockResolvedValue(PIVOT);
    useSession({ row: null, cast: [] });

    await expect(AuthenticatedLayout({ children })).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each(["/settings", "/settings/anything"])("never redirects %s, so sign-out and account deletion stay reachable", async (pathname) => {
    request.pathname = pathname;
    getFlags.mockResolvedValue(PIVOT);
    const client = useSession({ row: null });

    await expect(AuthenticatedLayout({ children })).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("still redirects a path that only starts like settings, or when the path is unknown", async () => {
    getFlags.mockResolvedValue(PIVOT);
    useSession({ row: null });

    request.pathname = "/settingsx";
    await expect(AuthenticatedLayout({ children })).rejects.toThrow("NEXT_REDIRECT;/onboarding");
    request.pathname = null;
    await expect(AuthenticatedLayout({ children })).rejects.toThrow("NEXT_REDIRECT;/onboarding");
  });

  it("lets a user with both through", async () => {
    getFlags.mockResolvedValue(PIVOT);
    useSession({ row: complete });

    await expect(AuthenticatedLayout({ children })).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  // AppShell is mocked, so the layout's element holds the props it was given.
  it("gives the shell the user's total consistency days, or none when they can't be read", async () => {
    getFlags.mockResolvedValue(PIVOT);
    useSession({ row: complete });

    expect((await AuthenticatedLayout({ children })).props.consistencyDays).toBe(4);
    expect(getConsistencySummary).toHaveBeenCalledWith(userId);

    getConsistencySummary.mockRejectedValue(new Error("consistency total unavailable"));
    expect((await AuthenticatedLayout({ children })).props.consistencyDays).toBeNull();
  });

  it("lets the user in when the profile cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getFlags.mockResolvedValue(PIVOT);
    useSession({ error: { code: "XX999", message: "boom" } });

    await expect(AuthenticatedLayout({ children })).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("never reads the coach profile while Pivot A is off", async () => {
    getFlags.mockResolvedValue(LEGACY);
    const client = useSession({ row: null });

    const layout = await AuthenticatedLayout({ children });
    expect(layout).toBeTruthy();
    expect(client.from).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    expect(getConsistencySummary).not.toHaveBeenCalled();
    expect(layout.props.consistencyDays).toBeNull();
  });

  it("still sends a signed-out visitor to log in", async () => {
    getFlags.mockResolvedValue(PIVOT);
    useSession({ user: null });

    await expect(AuthenticatedLayout({ children })).rejects.toThrow("NEXT_REDIRECT;/login");
  });
});

describe("the onboarding page", () => {
  it("keeps the existing flow while Pivot A is off", async () => {
    getFlags.mockResolvedValue(LEGACY);
    const client = useSession();

    const page = await OnboardingPage();

    expect(page.type).toBe(OnboardingFlow);
    expect(client.from).not.toHaveBeenCalled();
    // Rendered per request: a build-time render would freeze whichever flow the
    // flags picked during the build.
    expect(connection).toHaveBeenCalled();
    expect(connection.mock.invocationCallOrder[0]).toBeLessThan(getFlags.mock.invocationCallOrder[0]);
  });

  it("serves the Pivot A flow with the user's characters and saved profile", async () => {
    getFlags.mockResolvedValue(PIVOT);
    useSession({ row: { ...complete, timezone: null } });

    const page = await OnboardingPage();

    expect(page.type).toBe(PivotOnboarding);
    expect(page.props).toEqual({ characters: [launchCharacter], selectedCharacterId: characterId, savedTimezone: null });
  });
});

// Layouts do not re-run on client navigation but pages do, so the tasks page
// repeats the check for a user who entered through /settings.
describe("the tasks page under Pivot A", () => {
  it("sends a user who still needs onboarding there", async () => {
    getFlags.mockResolvedValue(PIVOT);
    useSession({ row: null });

    await expect(TasksPage()).rejects.toThrow("NEXT_REDIRECT;/onboarding");
  });

  it.each([
    ["a complete profile", { row: complete }],
    ["an empty cast", { row: null, cast: [] }],
    ["a failed read", { error: { code: "XX999", message: "boom" } }],
  ])("renders the board with %s", async (_name, session) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getFlags.mockResolvedValue(PIVOT);
    useSession(session);

    await expect(TasksPage()).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("never reads the coach profile while Pivot A is off", async () => {
    getFlags.mockResolvedValue(LEGACY);
    const client = useSession({ row: null });

    await expect(TasksPage()).resolves.toBeTruthy();
    expect(createClient).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  // TaskBoard is mocked, so the page's element tree holds the props it was given.
  const boardProps = (page: Awaited<ReturnType<typeof TasksPage>>) => (page.props as { children: { props: Record<string, unknown> } }).children.props;

  it("gives the board coach props with the user's character, public columns only", async () => {
    getFlags.mockResolvedValue(PIVOT);
    const client = useSession({ row: complete });
    const characters = client.from("characters") as unknown as { select: ReturnType<typeof vi.fn>; maybeSingle: ReturnType<typeof vi.fn> };
    characters.maybeSingle.mockResolvedValue({ data: { ...launchCharacter, art_url: "/characters/sample-coach.webp" }, error: null });

    const props = boardProps(await TasksPage());

    expect(props.coach).toEqual({ character: { id: characterId, slug: "sample-coach", name: "Sample Coach", artUrl: "/characters/sample-coach.webp" } });
    expect(props.pivotA).toBe(true);
    // The count comes from the layout, the one source for every surface.
    expect(props).not.toHaveProperty("consistencyDays");
    expect(getConsistencySummary).not.toHaveBeenCalled();
    expect(characters.select).toHaveBeenCalledWith("id, slug, name, art_url");
  });

  it("still gives the board coach props when the character can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getFlags.mockResolvedValue(PIVOT);
    useSession({ error: { code: "XX999", message: "boom" } });

    expect(boardProps(await TasksPage()).coach).toEqual({ character: null });
  });

  it("passes no coach props while Pivot A is off", async () => {
    getFlags.mockResolvedValue(LEGACY);
    useSession({ row: null });

    const props = boardProps(await TasksPage());

    expect(props.coach).toBeUndefined();
    expect(props.pivotA).toBe(false);
  });
});
