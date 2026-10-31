import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import type { TaskSplitResult } from "@idobata/contracts";
import { SplitSteps } from "@/components/coach/split-steps";

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

  it("falls back to the neutral line for a result it doesn't know", async () => {
    render(<SplitSteps request={Promise.resolve({ kind: "something_new" } as unknown as TaskSplitResult)} onDismiss={vi.fn()} />);

    expect(await screen.findByText("Splitting isn’t available right now.")).toBeVisible();
  });
});
