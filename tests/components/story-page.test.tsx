import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFlags } from "@/lib/domain/feature-flags";

const { apiRequest, createClient, getFlags, notFound, redirect } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  createClient: vi.fn(),
  getFlags: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); }),
  redirect: vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT;${path}`); }),
}));

vi.mock("@/lib/flags", () => ({ getFlags }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("next/navigation", () => ({ notFound, redirect }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("@/lib/client/api", () => ({ apiRequest, errorMessage: () => "Request failed.", isPreviewMode: false }));

import StoryPage from "@/app/(app)/story/page";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const character = { id: "c1000000-0000-4000-8000-000000000001", slug: "sample-coach", name: "Sample Coach", artUrl: null };

const launch = { id: character.id, slug: "sample-coach", name: "Sample Coach", role: "coach", art_url: null, is_launch: true, pack_sku: null };

function useDatabase(row: { selected_character_id: string | null; timezone: string | null } | null) {
  const chain = (list: unknown[], single: unknown) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      in: vi.fn(() => query),
      like: vi.fn(() => query),
      order: vi.fn(() => query),
      maybeSingle: vi.fn(() => Promise.resolve({ data: single, error: null })),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: list, error: null }).then(resolve),
    };
    return query;
  };
  const tables: Record<string, ReturnType<typeof chain>> = {
    user_coach_profiles: chain([], row && { ...row, age_verified_at: null }),
    characters: chain([launch], null),
    entitlements: chain([], null),
  };
  createClient.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: userId } } })) },
    from: vi.fn((table: string) => tables[table]),
  });
}

beforeEach(() => {
  getFlags.mockResolvedValue(resolveFlags({ "pivot_a.enabled": true }));
  apiRequest.mockImplementation((path: string) => path === "/api/story"
    ? Promise.resolve({ character, consistencyDays: 1, chapters: [{ number: 1, title: "The first page", unlocked: true, lock: null }] })
    : Promise.reject(new Error(`Unexpected request: ${path}`)));
});

describe("story page", () => {
  it("renders the story list under Pivot A", async () => {
    useDatabase({ selected_character_id: character.id, timezone: "America/Chicago" });

    const { container } = render(await StoryPage());

    expect(await screen.findByRole("button", { name: "Read chapter 1: The first page" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "Story" })).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("is not found while Pivot A is off, before touching the database", async () => {
    getFlags.mockResolvedValue(resolveFlags({}));
    useDatabase({ selected_character_id: character.id, timezone: "America/Chicago" });

    await expect(StoryPage()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("sends a user without a character to onboarding", async () => {
    useDatabase({ selected_character_id: null, timezone: null });

    await expect(StoryPage()).rejects.toThrow("NEXT_REDIRECT;/onboarding");
  });
});
