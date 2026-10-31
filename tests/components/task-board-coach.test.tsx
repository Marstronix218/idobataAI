import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactionCharacter, ReactionPayload, TaskSplitResult } from "@idobata/contracts";
import type { Task } from "@/types";

const { apiRequest, router } = vi.hoisted(() => ({ apiRequest: vi.fn(), router: { refresh: vi.fn() } }));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a>,
}));
// Only the Pivot A board uses the router; the legacy tests below run without it.
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/client/api", () => ({
  apiRequest,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : "Request failed.",
  isPreviewMode: false,
}));

import { TaskBoard } from "@/components/tasks/task-board";

const character: ReactionCharacter = { id: "c1000000-0000-4000-8000-000000000001", slug: "sample-coach", name: "Sample Coach", artUrl: null };
const now = new Date().toISOString();

function task(id: string, title: string): Task {
  return {
    id, owner_id: "u1", title, description: null, category: null, due_at: now, due_has_time: false, due_timezone: null,
    recurrence_rule: null, recurrence_instance_id: null, priority: null, visibility: "private", status: "pending",
    xp_earned: 0, completed_at: null, created_at: now, updated_at: now,
  };
}

const laundry = task("t1", "Fold the laundry");
const email = task("t2", "Reply to the landlord");

function reaction(text: string): ReactionPayload {
  return { kind: "reaction", text, source: "ai", character, disclosure: null };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

const apiError = (code: string, status: number) => Object.assign(new Error(`Raw server message ${code}`), { code, status });

/** Routes not given here reject, so an unexpected call fails loudly. */
function serve(routes: Record<string, (init?: RequestInit) => unknown> = {}) {
  apiRequest.mockImplementation((path: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${path}`;
    if (key === "GET /api/tasks") return Promise.resolve([laundry, email]);
    if (key === "GET /api/task-categories") return Promise.resolve([]);
    if (key === "GET /api/profile") return Promise.resolve({ daily_goal: 3, current_streak: 2, default_task_visibility: "private" });
    if (routes[key]) return routes[key](init);
    return Promise.reject(new Error(`Unexpected request: ${key}`));
  });
}

const calls = () => apiRequest.mock.calls.map(([path, init]) => `${(init as RequestInit | undefined)?.method ?? "GET"} ${path}`);

async function renderCoachBoard() {
  const view = render(<TaskBoard shareWin pivotA coach={{ character }} />);
  await screen.findByRole("heading", { name: "Fold the laundry" });
  return view;
}

beforeEach(() => {
  apiRequest.mockReset();
});

describe("TaskBoard under Pivot A", () => {
  it("starts a task at once and shows the character's reaction in the coach panel", async () => {
    const start = deferred<unknown>();
    serve({ "POST /api/tasks/t1/start": () => start.promise });
    await renderCoachBoard();

    fireEvent.click(screen.getByRole("button", { name: "Start: Fold the laundry" }));

    // The task changes straight away; only the bubble waits.
    expect(screen.getByRole("button", { name: "In progress: Fold the laundry" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("button", { name: "Start: Fold the laundry" })).not.toBeInTheDocument();
    expect(screen.getByText("Sample Coach is typing")).toBeInTheDocument();
    expect(apiRequest).toHaveBeenCalledWith("/api/tasks/t1/start", { method: "POST" });

    await act(async () => start.resolve({ event: { id: "e1", type: "started", occurredAt: now }, reaction: reaction("Fold the laundry, one basket. Go.") }));

    expect(screen.getByText("Fold the laundry, one basket. Go.")).toBeVisible();
    expect(screen.queryByText("Sample Coach is typing")).not.toBeInTheDocument();
    // The other task keeps its own Start control: there is one panel, not chatter per row.
    expect(screen.getByRole("button", { name: "Start: Reply to the landlord" })).toBeVisible();
  });

  it("keeps the task in progress and shows no error when the start request fails", async () => {
    serve({ "POST /api/tasks/t1/start": () => Promise.reject(apiError("internal_error", 500)) });
    const { container } = await renderCoachBoard();

    fireEvent.click(screen.getByRole("button", { name: "Start: Fold the laundry" }));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByRole("button", { name: "In progress: Fold the laundry" })).toBeVisible();
    expect(screen.queryByText("Sample Coach is typing")).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Raw server message|failed|error/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("finishes through the finish route, not PATCH, and shows the reaction", async () => {
    const finish = deferred<unknown>();
    serve({ "POST /api/tasks/t1/finish": () => finish.promise });
    await renderCoachBoard();

    fireEvent.click(screen.getByRole("button", { name: "Complete: Fold the laundry" }));

    // Optimistic: done before the server answers.
    expect(screen.getByRole("heading", { name: "Fold the laundry", level: 2 })).toBeVisible();
    expect(screen.getByText("Sample Coach is typing")).toBeInTheDocument();

    await act(async () => finish.resolve({
      task: { ...laundry, status: "completed", completed_at: now },
      reaction: reaction("Laundry folded. Rest, or pick the next one."),
    }));

    expect(screen.getByText("Laundry folded. Rest, or pick the next one.")).toBeVisible();
    expect(apiRequest).toHaveBeenCalledWith("/api/tasks/t1/finish", { method: "POST" });
    expect(calls().filter((call) => call.startsWith("PATCH"))).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent("Fold the laundry completed and remains off the feed.");
  });

  it("undoes a finish through PATCH back to pending", async () => {
    serve({
      "POST /api/tasks/t1/finish": () => Promise.resolve({ task: { ...laundry, status: "completed", completed_at: now }, reaction: null }),
      "PATCH /api/tasks/t1": () => Promise.resolve(laundry),
    });
    await renderCoachBoard();

    fireEvent.click(screen.getByRole("button", { name: "Complete: Fold the laundry" }));
    await screen.findByText("Fold the laundry completed and remains off the feed.");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(await screen.findByText("Fold the laundry moved back to open tasks.")).toBeVisible();
    expect(apiRequest).toHaveBeenCalledWith("/api/tasks/t1", { method: "PATCH", body: JSON.stringify({ status: "pending" }) });
    expect(calls().filter((call) => call.endsWith("/finish"))).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Complete: Fold the laundry" })).toBeVisible();
  });

  it("refreshes the server components once finishing pauses, so the consistency days update everywhere", async () => {
    serve({
      "POST /api/tasks/t1/finish": () => Promise.resolve({ task: { ...laundry, status: "completed", completed_at: now }, reaction: null }),
      "POST /api/tasks/t2/finish": () => Promise.resolve({ task: { ...email, status: "completed", completed_at: now }, reaction: null }),
    });
    await renderCoachBoard();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      // Each click settles inside act, so the finish lands at that moment.
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Complete: Fold the laundry" })); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Complete: Reply to the landlord" })); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      expect(router.refresh).not.toHaveBeenCalled();

      await act(async () => { await vi.advanceTimersByTimeAsync(600); });

      expect(router.refresh).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not refresh after a failed finish", async () => {
    serve({ "POST /api/tasks/t1/finish": () => Promise.reject(apiError("internal_error", 500)) });
    await renderCoachBoard();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      fireEvent.click(screen.getByRole("button", { name: "Complete: Fold the laundry" }));
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

      expect(screen.getByRole("alert")).toBeVisible();
      expect(router.refresh).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rolls a failed finish back like any completion, with no reaction", async () => {
    serve({ "POST /api/tasks/t1/finish": () => Promise.reject(apiError("internal_error", 500)) });
    await renderCoachBoard();

    fireEvent.click(screen.getByRole("button", { name: "Complete: Fold the laundry" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Raw server message internal_error");
    expect(screen.getByRole("button", { name: "Complete: Fold the laundry" })).toBeVisible();
    expect(screen.queryByText("Sample Coach is typing")).not.toBeInTheDocument();
  });

  it("splits a stuck task into three steps in the character's voice", async () => {
    const split = deferred<TaskSplitResult>();
    serve({ "POST /api/tasks/t2/split": () => split.promise });
    const { container } = await renderCoachBoard();

    const toggle = screen.getByRole("button", { name: "Stuck? Split it: Reply to the landlord" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Sample Coach is typing")).toBeInTheDocument();

    await act(async () => split.resolve({
      kind: "split",
      intro: "Three small moves for the landlord reply.",
      steps: ["Open the landlord's last email", "Write two sentences", "Press send"],
      character,
    }));

    const row = screen.getByRole("heading", { name: "Reply to the landlord" }).closest("article")!;
    expect(within(row).getByText("Three small moves for the landlord reply.")).toBeVisible();
    expect(within(row).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Open the landlord's last email", "Write two sentences", "Press send"]);
    expect(apiRequest).toHaveBeenCalledWith("/api/tasks/t2/split", { method: "POST" });
    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(within(row).getByRole("button", { name: "Close steps" }));
    expect(screen.queryByText("Three small moves for the landlord reply.")).not.toBeInTheDocument();
  });

  it("shows a minimal Plus notice with Not now when the plan doesn't include splitting", async () => {
    serve({ "POST /api/tasks/t2/split": () => Promise.reject(apiError("plan_required", 402)) });
    const { container } = await renderCoachBoard();

    fireEvent.click(screen.getByRole("button", { name: "Stuck? Split it: Reply to the landlord" }));

    expect(await screen.findByText("Splitting a task into steps comes with Plus.")).toBeVisible();
    expect(container.textContent).not.toMatch(/Raw server message|\$/);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText("Splitting a task into steps comes with Plus.")).not.toBeInTheDocument();
  });

  it.each([
    ["split_unavailable", 503, "Splitting isn’t available right now."],
    ["split_cap_reached", 429, "No more splits today."],
    ["network_error", 0, "Splitting isn’t available right now."],
  ])("shows a short neutral line, never the raw error, for %s", async (code, status, line) => {
    serve({ "POST /api/tasks/t2/split": () => Promise.reject(apiError(code, status)) });
    const { container } = await renderCoachBoard();

    fireEvent.click(screen.getByRole("button", { name: "Stuck? Split it: Reply to the landlord" }));

    expect(await screen.findByText(line)).toBeVisible();
    expect(container.textContent).not.toContain("Raw server message");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reuses a task's split when it is reopened rather than spending another", async () => {
    serve({ "POST /api/tasks/t2/split": () => Promise.resolve({ kind: "split", intro: "Here's the plan.", steps: ["One", "Two", "Three"], character }) });
    await renderCoachBoard();
    const toggle = screen.getByRole("button", { name: "Stuck? Split it: Reply to the landlord" });

    fireEvent.click(toggle);
    expect(await screen.findByText("Here's the plan.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close steps" }));
    // The close button is gone; focus goes back to the toggle.
    await waitFor(() => expect(toggle).toHaveFocus());
    fireEvent.click(toggle);

    expect(await screen.findByText("Here's the plan.")).toBeVisible();
    expect(calls().filter((call) => call.endsWith("/split"))).toHaveLength(1);
  });

  it("retries a split that failed, since nothing was spent", async () => {
    let attempts = 0;
    serve({ "POST /api/tasks/t2/split": () => ++attempts === 1 ? Promise.reject(apiError("split_unavailable", 503)) : Promise.resolve({ kind: "split", intro: "Second try.", steps: ["One", "Two", "Three"], character }) });
    await renderCoachBoard();
    const toggle = screen.getByRole("button", { name: "Stuck? Split it: Reply to the landlord" });

    fireEvent.click(toggle);
    await screen.findByText("Splitting isn’t available right now.");
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(await screen.findByText("Second try.")).toBeVisible();
  });

  it("shows a split's crisis card in the coach panel instead of steps, and keeps it there", async () => {
    serve({
      "POST /api/tasks/t2/split": () => Promise.resolve({ kind: "crisis" }),
      "POST /api/tasks/t1/start": () => Promise.resolve({ event: { id: "e1", type: "started", occurredAt: now }, reaction: reaction("Banter that must not cover the card.") }),
    });
    await renderCoachBoard();
    const toggle = screen.getByRole("button", { name: "Stuck? Split it: Reply to the landlord" });

    fireEvent.click(toggle);

    const heading = await screen.findByRole("heading", { name: "988 Suicide & Crisis Lifeline" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole("link", { name: "Call 988" })).toHaveAttribute("href", "tel:988");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Sample Coach is typing")).not.toBeInTheDocument();

    // Later banter never covers it; only dismissing does, and focus returns to the toggle.
    fireEvent.click(screen.getByRole("button", { name: "Start: Fold the laundry" }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("heading", { name: "988 Suicide & Crisis Lifeline" })).toBeVisible();
    expect(screen.queryByText("Banter that must not cover the card.")).not.toBeInTheDocument();
  });

  it("returns focus to the split toggle when a split's crisis card is dismissed", async () => {
    serve({ "POST /api/tasks/t2/split": () => Promise.resolve({ kind: "crisis" }) });
    await renderCoachBoard();
    const toggle = screen.getByRole("button", { name: "Stuck? Split it: Reply to the landlord" });
    toggle.focus();

    fireEvent.click(toggle);
    await screen.findByRole("heading", { name: "988 Suicide & Crisis Lifeline" });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss crisis resources" }));

    expect(screen.queryByRole("heading", { name: "988 Suicide & Crisis Lifeline" })).not.toBeInTheDocument();
    await waitFor(() => expect(toggle).toHaveFocus());
  });

  it("stops offering to post a finished task whose reaction was the crisis card", async () => {
    serve({ "POST /api/tasks/t1/finish": () => Promise.resolve({ task: { ...laundry, status: "completed", completed_at: now }, reaction: { kind: "crisis" } }) });
    await renderCoachBoard();

    fireEvent.click(screen.getByRole("button", { name: "Complete: Fold the laundry" }));

    expect(await screen.findByRole("heading", { name: "988 Suicide & Crisis Lifeline" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Post the win" })).not.toBeInTheDocument();
    expect(screen.queryByText("Post it and the people following you can cheer you on.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Completed/ }));
    expect(screen.queryByRole("link", { name: "Post" })).not.toBeInTheDocument();
  });

  it("keeps a later task's Undo locked until its own finish returns", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    serve({ "POST /api/tasks/t1/finish": () => first.promise, "POST /api/tasks/t2/finish": () => second.promise });
    await renderCoachBoard();

    fireEvent.click(screen.getByRole("button", { name: "Complete: Fold the laundry" }));
    fireEvent.click(screen.getByRole("button", { name: "Complete: Reply to the landlord" }));
    await act(async () => first.resolve({ task: { ...laundry, status: "completed", completed_at: now }, reaction: null }));

    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    await act(async () => second.resolve({ task: { ...email, status: "completed", completed_at: now }, reaction: null }));
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
  });

  it("shows the crisis card instead of banter when a start routes to crisis", async () => {
    serve({ "POST /api/tasks/t1/start": () => Promise.resolve({ event: { id: "e1", type: "started", occurredAt: now }, reaction: { kind: "crisis" } }) });
    await renderCoachBoard();

    fireEvent.click(screen.getByRole("button", { name: "Start: Fold the laundry" }));

    expect(await screen.findByRole("heading", { name: "988 Suicide & Crisis Lifeline" })).toBeVisible();
    expect(screen.queryByText("Sample Coach")).not.toBeInTheDocument();
  });

  it("shows the crisis card in the coach panel when a new task's text is flagged, and keeps the task", async () => {
    const flagged = task("t3", "Sort the drawer");
    serve({
      "POST /api/tasks": () => Promise.resolve({ ...flagged, safety: { crisisCard: true } }),
      "POST /api/tasks/t1/start": () => Promise.resolve({ event: { id: "e1", type: "started", occurredAt: now }, reaction: reaction("Banter that must not cover the card.") }),
    });
    await renderCoachBoard();

    fireEvent.change(screen.getByLabelText("Add a task"), { target: { value: "Sort the drawer" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    const heading = await screen.findByRole("heading", { name: "988 Suicide & Crisis Lifeline" });
    await waitFor(() => expect(heading).toHaveFocus());
    // The task is saved and listed; the panel shows no banter for this event.
    expect(screen.getByRole("heading", { name: "Sort the drawer" })).toBeVisible();
    expect(screen.queryByText("Sample Coach is typing")).not.toBeInTheDocument();

    // Later banter never covers the card until it is dismissed.
    fireEvent.click(screen.getByRole("button", { name: "Start: Fold the laundry" }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("heading", { name: "988 Suicide & Crisis Lifeline" })).toBeVisible();
    expect(screen.queryByText("Banter that must not cover the card.")).not.toBeInTheDocument();
  });

  it("shows the crisis card when an edited title is flagged, and saves the edit", async () => {
    serve({ "PATCH /api/tasks/t1": () => Promise.resolve({ ...laundry, title: "Fold the laundry tonight", safety: { crisisCard: true } }) });
    await renderCoachBoard();

    fireEvent.click(screen.getByRole("button", { name: "Edit Fold the laundry" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Fold the laundry tonight" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("heading", { name: "988 Suicide & Crisis Lifeline" })).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Fold the laundry tonight" })).toBeVisible();
    expect(screen.getByText("Task changes saved.")).toBeInTheDocument();
  });

  it("adds a task at once as a pending row, then swaps in the saved task with nothing in the coach panel", async () => {
    const create = deferred<unknown>();
    serve({ "POST /api/tasks": () => create.promise });
    await renderCoachBoard();

    fireEvent.change(screen.getByLabelText("Add a task"), { target: { value: "Sort the drawer" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    // Shown straight away, before the server (and its distress check) answers.
    const pendingRow = screen.getByRole("heading", { name: "Sort the drawer" }).closest("article") as HTMLElement;
    expect(pendingRow).toHaveAttribute("aria-busy", "true");
    expect(within(pendingRow).getByText("Saving…")).toBeInTheDocument();
    expect(within(pendingRow).getByRole("button", { name: "Complete: Sort the drawer" })).toBeDisabled();
    expect(within(pendingRow).getByRole("button", { name: "Edit Sort the drawer" })).toBeDisabled();
    expect(within(pendingRow).queryByRole("button", { name: "Start: Sort the drawer" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Add a task")).toHaveValue("");

    await act(async () => create.resolve(task("t3", "Sort the drawer")));

    expect(screen.getByText("Sort the drawer added privately.")).toBeInTheDocument();
    const savedRow = screen.getByRole("heading", { name: "Sort the drawer" }).closest("article") as HTMLElement;
    expect(savedRow).not.toHaveAttribute("aria-busy");
    expect(within(savedRow).queryByText("Saving…")).not.toBeInTheDocument();
    expect(within(savedRow).getByRole("button", { name: "Start: Sort the drawer" })).toBeVisible();
    expect(screen.getAllByRole("heading", { name: "Sort the drawer" })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "988 Suicide & Crisis Lifeline" })).not.toBeInTheDocument();
    expect(screen.queryByText("Sample Coach is typing")).not.toBeInTheDocument();
  });

  it("removes the pending row and gives the text back when adding fails", async () => {
    serve({ "POST /api/tasks": () => Promise.reject(apiError("internal_error", 500)) });
    await renderCoachBoard();

    fireEvent.change(screen.getByLabelText("Add a task"), { target: { value: "Sort the drawer" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Raw server message internal_error");
    expect(screen.queryByRole("heading", { name: "Sort the drawer" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Add a task")).toHaveValue("Sort the drawer");
  });

  it("has no automated accessibility violations with a reaction showing", async () => {
    serve({ "POST /api/tasks/t1/start": () => Promise.resolve({ event: { id: "e1", type: "started", occurredAt: now }, reaction: reaction("Go fold.") }) });
    const { container } = await renderCoachBoard();

    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(screen.getByRole("button", { name: "Start: Fold the laundry" }));
    await screen.findByText("Go fold.");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("TaskBoard with today's flags", () => {
  it("adds no coach controls or panel and completes through PATCH", async () => {
    serve({ "PATCH /api/tasks/t1": () => Promise.resolve({ ...laundry, status: "completed", completed_at: now }) });
    render(<TaskBoard shareWin />);
    await screen.findByRole("heading", { name: "Fold the laundry" });

    expect(screen.queryByRole("button", { name: /^Start/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Split it/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Complete: Fold the laundry" }));
    await screen.findByText("Fold the laundry completed and remains off the feed.");

    expect(apiRequest).toHaveBeenCalledWith("/api/tasks/t1", { method: "PATCH", body: JSON.stringify({ status: "completed" }) });
    expect(calls().some((call) => /\/(start|finish|split)$/.test(call))).toBe(false);
  });

  it("never shows a crisis card on a create or edit response", async () => {
    // The server only adds `safety` under Pivot A; the legacy board has no coach panel either way.
    serve({ "POST /api/tasks": () => Promise.resolve({ ...task("t3", "Sort the drawer"), safety: { crisisCard: true } }) });
    render(<TaskBoard shareWin />);
    await screen.findByRole("heading", { name: "Fold the laundry" });

    fireEvent.change(screen.getByLabelText("Add a task"), { target: { value: "Sort the drawer" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    expect(await screen.findByRole("heading", { name: "Sort the drawer" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "988 Suicide & Crisis Lifeline" })).not.toBeInTheDocument();
  });

  it("stays the same under Pivot A until the page passes coach props", async () => {
    serve();
    render(<TaskBoard shareWin pivotA />);
    await screen.findByRole("heading", { name: "Fold the laundry" });

    expect(screen.queryByRole("button", { name: /^Start/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Split it/ })).not.toBeInTheDocument();
  });
});
