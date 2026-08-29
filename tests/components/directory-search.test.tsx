import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("@/lib/client/api", () => ({
  apiRequest,
  isPreviewMode: false,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : "Request failed.",
}));

import { DirectorySearch } from "@/components/social/directory-search";

const jonah = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  username: "jonah",
  display_name: "Jonah Reed",
  avatar_url: null,
  bio: "Shipping one small thing a day.",
  follower_count: 12,
  viewer_follows: false,
};

const moss = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  slug: "moss",
  name: "Moss",
  avatar_url: null,
  personality: "An ancient tree observing the city.",
  viewer_follows: false,
};

const both = { people: [jonah], personas: [moss] };
const searchBox = () => screen.getByLabelText("Search people and AI personas");

describe("DirectorySearch", () => {
  beforeEach(() => {
    apiRequest.mockReset();
  });

  it("stays out of the way until the reader searches", () => {
    render(<DirectorySearch />);

    expect(searchBox()).toHaveValue("");
    expect(apiRequest).not.toHaveBeenCalled();
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();
  });

  it("returns people and AI personas from one query, each labelled", async () => {
    apiRequest.mockResolvedValue(both);
    render(<DirectorySearch />);

    fireEvent.change(searchBox(), { target: { value: "mo" } });

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      "/api/directory/search?query=mo",
      expect.objectContaining({ signal: expect.anything() }),
    ));
    expect(await screen.findByRole("heading", { name: "People" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI personas" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Jonah Reed" })).toHaveAttribute("href", "/u/jonah");
    expect(screen.getByRole("link", { name: "Moss" })).toHaveAttribute("href", "/ai-personas/moss");
    // The AI label is a product promise, not decoration: a persona row must
    // never be mistakable for a person's.
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("An ancient tree observing the city.")).toBeInTheDocument();
  });

  it("omits a group entirely when only the other kind matches", async () => {
    apiRequest.mockResolvedValue({ people: [jonah], personas: [] });
    render(<DirectorySearch />);

    fireEvent.change(searchBox(), { target: { value: "jonah" } });

    await screen.findByRole("heading", { name: "People" });
    expect(screen.queryByRole("heading", { name: "AI personas" })).not.toBeInTheDocument();
  });

  it("follows a person through the human follow route", async () => {
    apiRequest.mockResolvedValue(both);
    render(<DirectorySearch />);
    fireEvent.change(searchBox(), { target: { value: "jonah" } });
    await screen.findByRole("button", { name: "Follow Jonah Reed" });

    apiRequest.mockResolvedValueOnce({ following: true });
    fireEvent.click(screen.getByRole("button", { name: "Follow Jonah Reed" }));

    // Optimistic: the button and the follower count both move before the
    // request resolves.
    expect(screen.getByRole("button", { name: "Unfollow Jonah Reed" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("13 followers")).toBeInTheDocument();
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      `/api/users/${jonah.id}/follow`,
      { method: "PUT" },
    ));
  });

  it("follows an AI persona through the companion relationship route", async () => {
    apiRequest.mockResolvedValue(both);
    render(<DirectorySearch />);
    fireEvent.change(searchBox(), { target: { value: "moss" } });
    await screen.findByRole("button", { name: "Follow Moss" });

    apiRequest.mockResolvedValueOnce({ relationship: {} });
    fireEvent.click(screen.getByRole("button", { name: "Follow Moss" }));

    expect(screen.getByRole("button", { name: "Unfollow Moss" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      `/api/companions/${moss.id}/relationship`,
      { method: "PUT", body: JSON.stringify({ action: "follow", following: true }) },
    ));
  });

  it("unfollows an AI persona with a delete rather than a follow payload", async () => {
    apiRequest.mockResolvedValue({ people: [], personas: [{ ...moss, viewer_follows: true }] });
    render(<DirectorySearch />);
    fireEvent.change(searchBox(), { target: { value: "moss" } });
    await screen.findByRole("button", { name: "Unfollow Moss" });

    apiRequest.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Unfollow Moss" }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      `/api/companions/${moss.id}/relationship`,
      { method: "DELETE" },
    ));
    expect(screen.getByRole("button", { name: "Follow Moss" })).toHaveAttribute("aria-pressed", "false");
  });

  it("reverts a failed persona follow without touching the people rows", async () => {
    apiRequest.mockResolvedValue(both);
    render(<DirectorySearch />);
    fireEvent.change(searchBox(), { target: { value: "mo" } });
    await screen.findByRole("button", { name: "Follow Moss" });

    apiRequest.mockRejectedValueOnce(new Error("That persona is unavailable."));
    fireEvent.click(screen.getByRole("button", { name: "Follow Moss" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That persona is unavailable.");
    expect(screen.getByRole("button", { name: "Follow Moss" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Follow Jonah Reed" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("12 followers")).toBeInTheDocument();
  });

  it("reverts a failed person follow and its count", async () => {
    apiRequest.mockResolvedValue(both);
    render(<DirectorySearch />);
    fireEvent.change(searchBox(), { target: { value: "jonah" } });
    await screen.findByRole("button", { name: "Follow Jonah Reed" });

    apiRequest.mockRejectedValueOnce(new Error("This profile cannot be followed."));
    fireEvent.click(screen.getByRole("button", { name: "Follow Jonah Reed" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This profile cannot be followed.");
    expect(screen.getByRole("button", { name: "Follow Jonah Reed" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("12 followers")).toBeInTheDocument();
  });

  it("explains an empty result instead of showing a blank panel", async () => {
    apiRequest.mockResolvedValue({ people: [], personas: [] });
    render(<DirectorySearch />);

    fireEvent.change(searchBox(), { target: { value: "nobody" } });

    expect(await screen.findByText("No matches")).toBeInTheDocument();
    expect(screen.getByText(/Private accounts do not appear here/)).toBeInTheDocument();
  });

  it("dismisses the results on Escape, then clears the box on a second Escape", async () => {
    apiRequest.mockResolvedValue(both);
    render(<DirectorySearch />);
    fireEvent.change(searchBox(), { target: { value: "jonah" } });
    await screen.findByRole("link", { name: "Jonah Reed" });

    fireEvent.keyDown(searchBox(), { key: "Escape" });
    expect(screen.queryByRole("link", { name: "Jonah Reed" })).not.toBeInTheDocument();
    expect(searchBox()).toHaveValue("jonah");

    fireEvent.keyDown(searchBox(), { key: "Escape" });
    expect(searchBox()).toHaveValue("");
  });

  it("closes the results when focus leaves the search entirely", async () => {
    apiRequest.mockResolvedValue(both);
    render(<><DirectorySearch /><button type="button">Elsewhere</button></>);
    fireEvent.change(searchBox(), { target: { value: "jonah" } });
    await screen.findByRole("link", { name: "Jonah Reed" });

    fireEvent.blur(searchBox(), { relatedTarget: screen.getByRole("button", { name: "Elsewhere" }) });

    expect(screen.queryByRole("link", { name: "Jonah Reed" })).not.toBeInTheDocument();
    // The query survives, so returning to the box resumes the same search.
    expect(searchBox()).toHaveValue("jonah");
  });

  it("keeps the results open while focus moves onto a Follow button inside them", async () => {
    apiRequest.mockResolvedValue(both);
    render(<DirectorySearch />);
    fireEvent.change(searchBox(), { target: { value: "moss" } });
    const follow = await screen.findByRole("button", { name: "Follow Moss" });

    fireEvent.blur(searchBox(), { relatedTarget: follow });

    expect(screen.getByRole("button", { name: "Follow Moss" })).toBeInTheDocument();
  });

  it("debounces keystrokes into a single request", async () => {
    apiRequest.mockResolvedValue(both);
    render(<DirectorySearch />);

    for (const value of ["j", "jo", "jon", "jona", "jonah"]) {
      fireEvent.change(searchBox(), { target: { value } });
    }

    await screen.findByRole("link", { name: "Jonah Reed" });
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledWith("/api/directory/search?query=jonah", expect.anything());
  });

  it("has no automated accessibility violations with results showing", async () => {
    apiRequest.mockResolvedValue(both);
    const { container } = render(<DirectorySearch />);
    fireEvent.change(searchBox(), { target: { value: "mo" } });
    await screen.findByRole("link", { name: "Jonah Reed" });

    expect(await axe(container)).toHaveNoViolations();
  });
});
