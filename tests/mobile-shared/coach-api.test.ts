import { describe, expect, it, vi } from "vitest";

import { ApiClientError, createApiClient } from "../../packages/api-client/src";
import { characterSummarySchema, coachProfileUpdateSchema } from "../../packages/contracts/src";

const character = {
  id: "c1000000-0000-4000-8000-000000000001",
  slug: "sample-coach",
  name: "Sample Coach",
  role: "coach",
  art_url: null,
  is_launch: true,
  pack_sku: null,
};
const profile = { selected_character_id: character.id, timezone: "America/Chicago", age_verified_at: null };

function clientReturning(data: unknown) {
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    void input;
    void init;
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return { fetch, client: createApiClient({ baseUrl: "https://example.com", getAccessToken: () => "token", fetch }) };
}

describe("coach contracts", () => {
  it("accepts a character or a time zone, and nothing else", () => {
    expect(coachProfileUpdateSchema.parse({ characterId: character.id })).toEqual({ characterId: character.id });
    expect(coachProfileUpdateSchema.parse({ timezone: " America/Chicago " })).toEqual({ timezone: "America/Chicago" });
    expect(coachProfileUpdateSchema.safeParse({}).success).toBe(false);
    expect(coachProfileUpdateSchema.safeParse({ characterId: "sample-coach" }).success).toBe(false);
    expect(coachProfileUpdateSchema.safeParse({ timezone: "Not/AZone" }).success).toBe(false);
    expect(coachProfileUpdateSchema.safeParse({ timezone: "America/Chicago", selectedCharacterId: character.id }).success).toBe(false);
  });

  it("never carries the character sheet", () => {
    const parsed = characterSummarySchema.parse({ ...character, sheet: { voice: "secret" } });

    expect("sheet" in parsed).toBe(false);
    expect(characterSummarySchema.safeParse({ ...character, role: "romance" }).success).toBe(false);
  });
});

describe("coach API client", () => {
  it("lists selectable characters", async () => {
    const { client, fetch } = clientReturning({ items: [character] });

    await expect(client.listCharacters()).resolves.toEqual([character]);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://example.com/api/characters");
  });

  it("reads and updates the coach profile", async () => {
    const { client, fetch } = clientReturning(profile);

    await expect(client.getCoachProfile()).resolves.toEqual(profile);
    await expect(client.updateCoachProfile({ timezone: "America/Chicago" })).resolves.toEqual(profile);

    const [url, init] = fetch.mock.calls[1] ?? [];
    expect(url).toBe("https://example.com/api/coach/profile");
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe(JSON.stringify({ timezone: "America/Chicago" }));
  });

  it("rejects an invalid response", async () => {
    const { client } = clientReturning({ items: [{ ...character, id: "not-a-uuid" }] });

    await expect(client.listCharacters()).rejects.toBeInstanceOf(ApiClientError);
    await expect(clientReturning({ timezone: 3 }).client.getCoachProfile()).rejects.toMatchObject({ code: "invalid_response" });
  });
});
