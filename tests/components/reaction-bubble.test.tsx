import { act, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactionCharacter, ReactionPayload } from "@idobata/contracts";
import { ReactionBubble } from "@/components/coach/reaction-bubble";

// Written out here rather than imported, so a change to the constant fails.
const SPEC_LINE = "AI character · not a person · not a therapist, doctor or lawyer";

const character: ReactionCharacter = { id: "c1000000-0000-4000-8000-000000000001", slug: "sample-coach", name: "Sample Coach", artUrl: null };

function reaction(text: string, disclosure: string | null = null): ReactionPayload {
  return { kind: "reaction", text, source: "prewritten", character, disclosure };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ReactionBubble", () => {
  it("renders nothing before any request", () => {
    const { container } = render(<ReactionBubble request={null} character={character} />);

    expect(container.textContent).toBe("");
  });

  it("shows the character typing while the request is in flight, then the reaction", async () => {
    const pending = deferred<ReactionPayload | null>();
    const { container } = render(<ReactionBubble request={pending.promise} character={character} />);

    expect(screen.getByText("Sample Coach is typing")).toBeInTheDocument();
    expect(screen.getByText("Sample Coach is typing").closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
    expect(await axe(container)).toHaveNoViolations();

    await act(async () => pending.resolve(reaction("Go draft that outline. Ten minutes, then rest.")));

    expect(screen.queryByText("Sample Coach is typing")).not.toBeInTheDocument();
    expect(screen.getByText("Go draft that outline. Ten minutes, then rest.")).toBeVisible();
    expect(screen.getByText("Sample Coach")).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("stops typing after about 3 seconds, and still shows a reaction that lands later", async () => {
    vi.useFakeTimers();
    const pending = deferred<ReactionPayload | null>();
    render(<ReactionBubble request={pending.promise} character={character} />);
    expect(screen.getByText("Sample Coach is typing")).toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(3_000); });
    expect(screen.queryByText("Sample Coach is typing")).not.toBeInTheDocument();

    await act(async () => pending.resolve(reaction("Late but here.")));
    expect(screen.getByText("Late but here.")).toBeVisible();
  });

  it("shows the AI disclosure word for word when the reaction carries one", async () => {
    render(<ReactionBubble request={Promise.resolve(reaction("First one today.", SPEC_LINE))} character={character} />);

    expect(await screen.findByText("First one today.")).toBeVisible();
    expect(screen.getByRole("note", { name: "AI disclosure" }).textContent).toBe(SPEC_LINE);
  });

  it("leaves the disclosure out when it is null", async () => {
    render(<ReactionBubble request={Promise.resolve(reaction("Second one today."))} character={character} />);

    expect(await screen.findByText("Second one today.")).toBeVisible();
    expect(screen.queryByRole("note", { name: "AI disclosure" })).not.toBeInTheDocument();
    expect(screen.queryByText(SPEC_LINE)).not.toBeInTheDocument();
  });

  it("replaces the banter with the crisis card", async () => {
    const { rerender } = render(<ReactionBubble request={Promise.resolve(reaction("Earlier banter."))} character={character} />);
    expect(await screen.findByText("Earlier banter.")).toBeVisible();

    rerender(<ReactionBubble request={Promise.resolve({ kind: "crisis" } as ReactionPayload)} character={character} />);

    expect(await screen.findByRole("heading", { name: "988 Suicide & Crisis Lifeline" })).toBeVisible();
    expect(screen.queryByText("Earlier banter.")).not.toBeInTheDocument();
    expect(screen.queryByText("Sample Coach")).not.toBeInTheDocument();
  });

  it("never lets later banter cover a crisis card the user has not dismissed", async () => {
    const { rerender } = render(<ReactionBubble request={Promise.resolve({ kind: "crisis" } as ReactionPayload)} character={character} />);
    expect(await screen.findByRole("heading", { name: "988 Suicide & Crisis Lifeline" })).toBeVisible();

    const next = Promise.resolve(reaction("Banter for the next task."));
    rerender(<ReactionBubble request={next} character={character} />);
    await act(async () => { await next; });

    expect(screen.getByRole("heading", { name: "988 Suicide & Crisis Lifeline" })).toBeVisible();
    expect(screen.queryByText("Banter for the next task.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss crisis resources" }));
    expect(screen.queryByRole("heading", { name: "988 Suicide & Crisis Lifeline" })).not.toBeInTheDocument();
  });

  it("shows a crisis result even after a newer request replaced its request", async () => {
    const first = deferred<ReactionPayload | null>();
    const second = deferred<ReactionPayload | null>();
    const { rerender } = render(<ReactionBubble request={first.promise} character={character} />);
    rerender(<ReactionBubble request={second.promise} character={character} />);

    await act(async () => first.resolve({ kind: "crisis" }));

    expect(screen.getByRole("heading", { name: "988 Suicide & Crisis Lifeline" })).toBeVisible();
  });

  it("shows no error when the request fails, and doesn't bring back a line about another task", async () => {
    const { container, rerender } = render(<ReactionBubble request={Promise.resolve(reaction("About the first task."))} character={character} />);
    expect(await screen.findByText("About the first task.")).toBeVisible();

    const failing = Promise.reject(new Error("Request failed (500)."));
    rerender(<ReactionBubble request={failing} character={character} />);
    await act(async () => { await failing.catch(() => undefined); });

    expect(screen.queryByText("About the first task.")).not.toBeInTheDocument();
    expect(screen.queryByText("Sample Coach is typing")).not.toBeInTheDocument();
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows nothing at all when the first request fails or returns no reaction", async () => {
    const failing = Promise.reject(new Error("offline"));
    const { container, rerender } = render(<ReactionBubble request={failing} character={character} />);
    await act(async () => { await failing.catch(() => undefined); });
    expect(container.textContent).toBe("");

    const empty = Promise.resolve(null);
    rerender(<ReactionBubble request={empty} character={character} />);
    await act(async () => { await empty; });
    expect(container.textContent).toBe("");
  });
});
