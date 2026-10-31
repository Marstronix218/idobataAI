import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFlags } from "@/lib/domain/feature-flags";

const { authed, getFlags } = vi.hoisted(() => ({ authed: vi.fn(), getFlags: vi.fn() }));

// The real withApi and assertDatabase, so errors answer as they do in production.
vi.mock("@/lib/server/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/http")>()),
  authed,
}));
vi.mock("@/lib/flags", () => ({ getFlags }));
// Age verified; the guard itself is covered by tests/integration/coach-age-guard.test.ts.
vi.mock("@/lib/coach/age", () => ({ isAgeVerified: vi.fn(async () => true), requireAgeVerified: vi.fn(async () => undefined) }));

import { GET } from "@/app/api/characters/route";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOT_FOUND = { error: { code: "not_found", message: "Resource not found." } };

const launch = { id: "c1000000-0000-4000-8000-000000000001", slug: "launch-coach", name: "Launch Coach", role: "coach", art_url: "/characters/launch.webp", is_launch: true, pack_sku: null };
const ownedPack = { id: "c1000000-0000-4000-8000-000000000002", slug: "owned-pack", name: "Owned Pack", role: "rival", art_url: null, is_launch: false, pack_sku: "pack_owned" };
const otherPack = { id: "c1000000-0000-4000-8000-000000000003", slug: "other-pack", name: "Other Pack", role: "deadpan", art_url: null, is_launch: false, pack_sku: "pack_other" };

type Result = { data: unknown; error: { message: string; code?: string } | null };

/** A thenable PostgREST chain that records every call. */
function queryChain(result: Result) {
  const chain = {} as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<Result>;
  for (const method of ["select", "eq", "like", "in", "order"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function useDatabase(characters: Result, entitlements: Result) {
  const tables = { characters: queryChain(characters), entitlements: queryChain(entitlements) };
  const from = vi.fn((table: keyof typeof tables) => tables[table]);
  authed.mockResolvedValue({ user: { id: userId }, supabase: { from } });
  return { from, ...tables };
}

const request = () => new Request("http://localhost/api/characters", { headers: { authorization: "Bearer token" } });

describe("GET /api/characters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFlags.mockResolvedValue(resolveFlags({ "pivot_a.enabled": true }));
  });

  it("lists launch characters and owned packs only, naming its columns so the sheet is never requested", async () => {
    const db = useDatabase(
      // RLS already hides inactive rows; packs the user does not own still come back.
      { data: [launch, ownedPack, otherPack], error: null },
      { data: [{ product: "pack:owned-pack", status: "active", trial_ends_at: null, current_period_end: null }], error: null },
    );

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { items: [launch, ownedPack] } });
    expect(db.characters.select).toHaveBeenCalledWith("id, slug, name, role, art_url, is_launch, pack_sku");
    const selected = String(db.characters.select.mock.calls[0]?.[0]);
    expect(selected).not.toContain("sheet");
    expect(selected).not.toContain("*");
    expect(db.characters.eq).toHaveBeenCalledWith("active", true);
    expect(db.entitlements.select).toHaveBeenCalledWith("product, status, trial_ends_at, current_period_end");
    expect(db.entitlements.eq).toHaveBeenCalledWith("user_id", userId);
    expect(db.entitlements.like).toHaveBeenCalledWith("product", "pack:%");
  });

  it("counts only an active pack as owned, the same rule as the story (packs have no trial)", async () => {
    const pack = (product: string, status: string) => ({ product, status, trial_ends_at: null, current_period_end: null });
    useDatabase(
      { data: [launch, ownedPack, otherPack], error: null },
      { data: [pack("pack:owned-pack", "trialing"), pack("pack:other-pack", "refunded")], error: null },
    );

    const response = await GET(request());

    expect(await response.json()).toEqual({ data: { items: [launch] } });
  });

  it("returns an empty list when nothing is selectable", async () => {
    useDatabase({ data: [otherPack], error: null }, { data: [], error: null });

    const response = await GET(request());

    expect(await response.json()).toEqual({ data: { items: [] } });
  });

  it("answers 404 before authenticating while Pivot A is off", async () => {
    getFlags.mockResolvedValue(resolveFlags({}));

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(NOT_FOUND);
    expect(authed).not.toHaveBeenCalled();
  });

  it("maps a database failure without leaking its message", async () => {
    useDatabase({ data: null, error: { code: "42501", message: "permission denied for column sheet" } }, { data: [], error: null });

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "forbidden", message: "You do not have access to that." } });
  });
});
