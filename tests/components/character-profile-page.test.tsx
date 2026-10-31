import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFlags } from "@/lib/domain/feature-flags";

const { createClient, getFlags, notFound } = vi.hoisted(() => ({
  createClient: vi.fn(),
  getFlags: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); }),
}));

vi.mock("@/lib/flags", () => ({ getFlags }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("next/navigation", () => ({ notFound, useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/client/api", () => ({ apiRequest: vi.fn(), errorMessage: () => "Request failed.", isPreviewMode: false }));

import CharacterProfilePage from "@/app/(app)/characters/[slug]/page";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DISCLOSURE = "AI character · not a person · not a therapist, doctor or lawyer";
const launch = { id: "c1000000-0000-4000-8000-000000000001", slug: "sample-coach", name: "Sample Coach", role: "coach", art_url: null, is_launch: true, pack_sku: null };
const pack = { id: "c1000000-0000-4000-8000-000000000002", slug: "pack-rival", name: "Pack Rival", role: "rival", art_url: null, is_launch: false, pack_sku: "pack_rival" };

function useDatabase({ character = null as object | null, packs = [] as string[], selected = null as string | null } = {}) {
  const chain = (result: unknown) => {
    const query = {} as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<unknown>;
    for (const method of ["select", "eq", "like", "in"]) query[method] = vi.fn(() => query);
    query.maybeSingle = vi.fn(() => Promise.resolve(result));
    query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
    return query;
  };
  const tables = {
    characters: chain({ data: character, error: null }),
    entitlements: chain({ data: packs.map((product) => ({ product })), error: null }),
    user_coach_profiles: chain({ data: { selected_character_id: selected, timezone: "America/Chicago", age_verified_at: null }, error: null }),
  };
  createClient.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: userId } } })) },
    from: vi.fn((table: keyof typeof tables) => tables[table]),
  });
  return tables;
}

const page = (slug: string) => CharacterProfilePage({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  vi.clearAllMocks();
  getFlags.mockResolvedValue(resolveFlags({ "pivot_a.enabled": true }));
});

describe("character profile page", () => {
  it("shows the name, role, AI disclosure and a choose button, from named columns only", async () => {
    const tables = useDatabase({ character: launch });

    const { container } = render(await page("sample-coach"));

    expect(screen.getByRole("heading", { level: 1, name: "Sample Coach" })).toBeVisible();
    expect(screen.getByText("Coach")).toBeVisible();
    expect(screen.getByRole("note", { name: "AI disclosure" }).textContent).toBe(DISCLOSURE);
    expect(screen.getByRole("button", { name: "Choose Sample Coach" })).toBeEnabled();
    expect(tables.characters.select).toHaveBeenCalledWith("id, slug, name, role, art_url, is_launch, pack_sku");
    expect(tables.characters.eq).toHaveBeenCalledWith("slug", "sample-coach");
    expect(tables.characters.eq).toHaveBeenCalledWith("active", true);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("marks the user's current character", async () => {
    useDatabase({ character: launch, selected: launch.id });

    render(await page("sample-coach"));

    expect(screen.getByText("Your character")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Choose/ })).not.toBeInTheDocument();
  });

  it("shows a pack character the user owns", async () => {
    useDatabase({ character: pack, packs: ["pack:pack-rival"] });

    render(await page("pack-rival"));

    expect(screen.getByRole("heading", { level: 1, name: "Pack Rival" })).toBeVisible();
  });

  it.each([
    ["an unknown or inactive slug", "missing", { character: null }],
    ["a pack the user does not own", "pack-rival", { character: pack, packs: ["pack:someone-else"] }],
  ])("is not found for %s", async (_name, slug, database) => {
    useDatabase(database);

    await expect(page(slug)).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("is not found for a malformed slug without querying", async () => {
    useDatabase({ character: launch });

    await expect(page("Not A Slug")).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("is not found while Pivot A is off", async () => {
    getFlags.mockResolvedValue(resolveFlags({}));
    useDatabase({ character: launch });

    await expect(page("sample-coach")).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(createClient).not.toHaveBeenCalled();
  });
});
