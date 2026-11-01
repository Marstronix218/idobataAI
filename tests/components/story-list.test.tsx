import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest, recordPaywallView } = vi.hoisted(() => ({ apiRequest: vi.fn(), recordPaywallView: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("@/lib/client/api", () => ({ apiRequest, errorMessage: () => "Request failed.", isPreviewMode: false }));
vi.mock("@/lib/client/analytics", () => ({ recordPaywallView }));

import { StoryList } from "@/components/coach/story-list";

const character = { id: "c1000000-0000-4000-8000-000000000001", slug: "sample-coach", name: "Sample Coach", artUrl: null };

const story = {
  character,
  consistencyDays: 2,
  chapters: [
    { number: 1, title: "The first page", unlocked: true, lock: null },
    { number: 2, title: "The second page", unlocked: true, lock: null },
    { number: 3, title: "A short list", unlocked: false, lock: { reason: "days", daysNeeded: 1 } },
    { number: 4, title: "A longer walk", unlocked: false, lock: { reason: "days", daysNeeded: 2 } },
    { number: 5, title: "The next notebook", unlocked: false, lock: { reason: "plan" } },
  ],
};

const bodies: Record<string, { number: number; title: string; body: string }> = {
  "/api/story/1": { number: 1, title: "The first page", body: "The coach opens a notebook.\n\nOne line: start small." },
  "/api/story/2": { number: 2, title: "The second page", body: "Two lines now." },
};

/** Routes not given here reject, so an unexpected request fails loudly. */
function serve(routes: Record<string, () => Promise<unknown>> = {}) {
  apiRequest.mockImplementation((path: string) => {
    if (routes[path]) return routes[path]();
    if (path === "/api/story") return Promise.resolve(story);
    if (bodies[path]) return Promise.resolve(bodies[path]);
    return Promise.reject(Object.assign(new Error(`Unexpected request: ${path}`), { status: 404 }));
  });
}

const requested = () => apiRequest.mock.calls.map(([path]) => path as string);

async function renderList() {
  const view = render(<StoryList />);
  await screen.findByRole("list", { name: "Chapters" });
  return view;
}

const chapterItem = (title: string) => screen.getByRole("heading", { level: 2, name: title }).closest("li")!;

beforeEach(() => {
  apiRequest.mockReset();
  recordPaywallView.mockReset();
});

describe("StoryList", () => {
  it("lists the character's chapters and opens an unlocked one in the reader", async () => {
    serve();
    await renderList();

    expect(screen.getByRole("heading", { level: 1, name: "Story" })).toBeVisible();
    expect(screen.getByText("Sample Coach")).toBeVisible();
    expect(within(screen.getByRole("list", { name: "Chapters" })).getAllByRole("listitem")).toHaveLength(5);

    fireEvent.click(screen.getByRole("button", { name: "Read chapter 1: The first page" }));

    const heading = await screen.findByRole("heading", { level: 1, name: "The first page" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(await screen.findByText("The coach opens a notebook.")).toBeVisible();
    expect(screen.getByText("One line: start small.")).toBeVisible();
    expect(requested()).toEqual(["/api/story", "/api/story/1"]);

    fireEvent.click(screen.getByRole("button", { name: "All chapters" }));

    const back = await screen.findByRole("button", { name: "Read chapter 1: The first page" });
    await waitFor(() => expect(back).toHaveFocus());
  });

  it("reopens a chapter it has already read without fetching it again", async () => {
    serve();
    await renderList();

    fireEvent.click(screen.getByRole("button", { name: "Read chapter 2: The second page" }));
    await screen.findByText("Two lines now.");
    fireEvent.click(screen.getByRole("button", { name: "All chapters" }));
    fireEvent.click(screen.getByRole("button", { name: "Read chapter 2: The second page" }));

    expect(screen.getByText("Two lines now.")).toBeVisible();
    expect(requested().filter((path) => path === "/api/story/2")).toHaveLength(1);
  });

  it("shows how many more finished-task days a chapter needs, without a Read button", async () => {
    serve();
    await renderList();

    const one = chapterItem("A short list");
    expect(within(one).getByText("Unlocks after 1 more day with a finished task.")).toBeVisible();
    expect(within(one).getByText("Chapter 3 · Locked")).toBeVisible();
    expect(within(one).queryByRole("button")).not.toBeInTheDocument();
    expect(within(chapterItem("A longer walk")).getByText("Unlocks after 2 more days with a finished task.")).toBeVisible();
  });

  it("shows the Plus placeholder for a chapter that needs a plan", async () => {
    serve();
    await renderList();

    const plan = chapterItem("The next notebook");
    expect(within(plan).getByText("This chapter comes with Plus.")).toBeVisible();
    expect(within(plan).queryByRole("button")).not.toBeInTheDocument();
    // Shown, so recorded once as a story paywall view (no chapter or title sent).
    expect(recordPaywallView.mock.calls).toEqual([["story"]]);
  });

  it("records no paywall view when no chapter needs a plan", async () => {
    serve({ "/api/story": () => Promise.resolve({ ...story, chapters: story.chapters.filter((chapter) => chapter.lock?.reason !== "plan") }) });
    await renderList();

    expect(screen.queryByText("This chapter comes with Plus.")).not.toBeInTheDocument();
    expect(recordPaywallView).not.toHaveBeenCalled();
  });

  it("never requests the body of a locked chapter", async () => {
    serve();
    await renderList();

    fireEvent.click(screen.getByRole("button", { name: "Read chapter 1: The first page" }));
    await screen.findByText("The coach opens a notebook.");

    expect(requested()).not.toContain("/api/story/3");
    expect(requested()).not.toContain("/api/story/4");
    expect(requested()).not.toContain("/api/story/5");
    expect(screen.queryByRole("button", { name: /Read chapter [345]/ })).not.toBeInTheDocument();
  });

  it("never mentions time in the app, countdowns or streaks", async () => {
    serve();
    const { container } = await renderList();

    expect(container.textContent).not.toMatch(/streak|minute|hour|left|hurry|countdown|time in/i);
  });

  it("shows a calm line in the reader when a chapter fails to load", async () => {
    serve({ "/api/story/1": () => Promise.reject(new Error("Raw server message")) });
    await renderList();

    fireEvent.click(screen.getByRole("button", { name: "Read chapter 1: The first page" }));

    expect(await screen.findByText("This chapter couldn’t load right now.")).toBeVisible();
    expect(screen.queryByText("Raw server message")).not.toBeInTheDocument();
  });

  it("offers a retry when the chapter list fails to load", async () => {
    let fail = true;
    serve({ "/api/story": () => fail ? Promise.reject(new Error("Raw server message")) : Promise.resolve(story) });
    render(<StoryList />);

    expect(await screen.findByText("The story couldn’t load right now.")).toBeVisible();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("list", { name: "Chapters" })).toBeVisible();
  });

  it("points to Settings when no character is selected", async () => {
    serve({ "/api/story": () => Promise.resolve({ character: null, consistencyDays: 0, chapters: [] }) });
    render(<StoryList />);

    expect(await screen.findByRole("link", { name: "Open Settings" })).toHaveAttribute("href", "/settings#character");
    expect(screen.queryByRole("list", { name: "Chapters" })).not.toBeInTheDocument();
  });

  it("has no automated accessibility violations in the list or the reader", async () => {
    serve();
    const { container } = await renderList();

    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(screen.getByRole("button", { name: "Read chapter 1: The first page" }));
    await screen.findByText("The coach opens a notebook.");

    expect(await axe(container)).toHaveNoViolations();
  });
});
