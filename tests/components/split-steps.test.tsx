import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import type { TaskSplitResult } from "@idobata/contracts";

const { recordPaywallView } = vi.hoisted(() => ({ recordPaywallView: vi.fn() }));
vi.mock("@/lib/client/analytics", () => ({ recordPaywallView }));

import { SplitSteps } from "@/components/coach/split-steps";

const failure = (code: string) => Promise.reject(Object.assign(new Error(`Raw ${code}`), { code }));

// The board sends a split's crisis to its coach panel; on its own, SplitSteps shows the card itself.
describe("SplitSteps", () => {
  it("shows the crisis card instead of steps", async () => {
    const { container } = render(<SplitSteps request={Promise.resolve({ kind: "crisis" })} onDismiss={vi.fn()} />);

    const heading = await screen.findByRole("heading", { name: "988 Suicide & Crisis Lifeline" });
    // The card moves focus in a passive effect, which can land after the heading is first found.
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("records a split paywall view once when the Plus notice shows", async () => {
    recordPaywallView.mockReset();
    render(<SplitSteps request={failure("plan_required")} onDismiss={vi.fn()} />);

    expect(await screen.findByText("Splitting a task into steps comes with Plus.")).toBeVisible();
    expect(recordPaywallView.mock.calls).toEqual([["split"]]);
  });

  it.each(["split_cap_reached", "split_unavailable"])("records no paywall view for %s", async (code) => {
    recordPaywallView.mockReset();
    render(<SplitSteps request={failure(code)} onDismiss={vi.fn()} />);

    expect(await screen.findByText(/No more splits today|Splitting isn’t available right now/)).toBeVisible();
    expect(recordPaywallView).not.toHaveBeenCalled();
  });

  it("falls back to the neutral line for a result it doesn't know", async () => {
    render(<SplitSteps request={Promise.resolve({ kind: "something_new" } as unknown as TaskSplitResult)} onDismiss={vi.fn()} />);

    expect(await screen.findByText("Splitting isn’t available right now.")).toBeVisible();
  });
});
