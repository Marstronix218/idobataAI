import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterSummary } from "@idobata/contracts";

const { apiRequest, router } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  router: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/client/api", () => ({
  apiRequest,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : "Request failed.",
  isPreviewMode: false,
}));

import { CharacterPicker, ChooseCharacterButton } from "@/components/coach/character-picker";

const DISCLOSURE = "AI character · not a person · not a therapist, doctor or lawyer";

const characters: CharacterSummary[] = [
  { id: "c1000000-0000-4000-8000-000000000001", slug: "sample-coach", name: "Sample Coach", role: "coach", art_url: "/characters/sample-coach.webp", is_launch: true, pack_sku: null },
  { id: "c1000000-0000-4000-8000-000000000002", slug: "pack-rival", name: "Pack Rival", role: "rival", art_url: null, is_launch: false, pack_sku: "pack_rival" },
];

beforeEach(() => {
  apiRequest.mockReset();
  apiRequest.mockResolvedValue({ selected_character_id: characters[1].id, timezone: null, age_verified_at: null });
});

describe("CharacterPicker", () => {
  it("shows a card per character with art or an initial, the role and the AI disclosure", async () => {
    const { container } = render(<CharacterPicker characters={characters} />);

    const cards = within(screen.getByRole("list", { name: "Characters" })).getAllByRole("listitem");
    expect(cards).toHaveLength(2);

    expect(within(cards[0]).getByRole("heading", { name: "Sample Coach" })).toBeVisible();
    expect(within(cards[0]).getByText("Coach")).toBeVisible();
    expect(cards[0].querySelector("img")).toHaveAttribute("src", "/characters/sample-coach.webp");
    expect(within(cards[1]).getByRole("heading", { name: "Pack Rival" })).toBeVisible();
    expect(within(cards[1]).getByText("Rival")).toBeVisible();
    expect(cards[1].querySelector("img")).toBeNull();
    expect(within(cards[1]).getByText("P")).toBeInTheDocument();

    for (const card of cards) {
      expect(within(card).getByRole("note", { name: "AI disclosure" }).textContent).toBe(DISCLOSURE);
    }
    expect(await axe(container)).toHaveNoViolations();
  });

  it("saves the choice through the coach profile route and reports it", async () => {
    const onChosen = vi.fn();
    render(<CharacterPicker characters={characters} onChosen={onChosen} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose Pack Rival" }));

    await waitFor(() => expect(onChosen).toHaveBeenCalledWith(characters[1]));
    expect(apiRequest).toHaveBeenCalledWith("/api/coach/profile", { method: "PUT", body: JSON.stringify({ characterId: characters[1].id }) });
    expect(within(screen.getAllByRole("listitem")[1]).getByText("Your character")).toBeVisible();
  });

  it("marks the saved character and keeps it when a new choice fails", async () => {
    apiRequest.mockRejectedValue(new Error("That character is not available."));
    const onChosen = vi.fn();
    render(<CharacterPicker characters={characters} selectedId={characters[0].id} onChosen={onChosen} />);
    expect(within(screen.getAllByRole("listitem")[0]).getByText("Your character")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Choose Pack Rival" }));

    expect(await screen.findByText("That character is not available.")).toBeVisible();
    expect(onChosen).not.toHaveBeenCalled();
    expect(within(screen.getAllByRole("listitem")[0]).getByText("Your character")).toBeVisible();
    expect(within(screen.getAllByRole("listitem")[1]).queryByText("Your character")).not.toBeInTheDocument();
  });

  it("says so when there is nothing to choose", () => {
    render(<CharacterPicker characters={[]} />);

    expect(screen.getByText("No characters are available yet.")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("ChooseCharacterButton", () => {
  it("saves the character and refreshes the profile", async () => {
    render(<ChooseCharacterButton character={characters[0]} selected={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose Sample Coach" }));

    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(apiRequest).toHaveBeenCalledWith("/api/coach/profile", { method: "PUT", body: JSON.stringify({ characterId: characters[0].id }) });
  });

  it("shows the current character instead of a button", () => {
    render(<ChooseCharacterButton character={characters[0]} selected />);

    expect(screen.getByText("Your character")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
