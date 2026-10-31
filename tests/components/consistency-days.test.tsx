import { render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { resolveFlags } from "@/lib/domain/feature-flags";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/feed" }));

import { ConsistencyDaysContext } from "@/components/coach/consistency-days";
import { AppShell } from "@/components/layout/app-shell";
import { MomentumRail } from "@/components/layout/momentum-rail";
import { TaskBoard } from "@/components/tasks/task-board";

// These render in Preview mode (tests/setup.ts), where the legacy streak is 6.
const PIVOT = resolveFlags({ "pivot_a.enabled": true });
const LEGACY = resolveFlags({});
const DESCRIPTION = "Days with at least one finished task";
// The sidebar and the bottom bar share one label; jsdom shows both at once.
const axeOptions = { rules: { "landmark-unique": { enabled: false } } };

/** Wording that must never appear under Pivot A: no streak, nothing lost, no zero. */
const GUILT = /streak|lost|broke|missed|0 days|0-day|\b0 day/i;

const sidebarCard = () => screen.getByRole("link", { name: "Open your profile" });
const momentum = () => screen.getByRole("region", { name: "Your momentum" });

/** The board reads the count the app shell provides. */
const board = (days: number | null, pivotA = true) => <ConsistencyDaysContext value={{ days }}><TaskBoard pivotA={pivotA} /></ConsistencyDaysContext>;

describe("consistency days under Pivot A", () => {
  describe("task board", () => {
    it("shows the count of days with a finished task instead of the streak", async () => {
      const { container } = render(board(5));

      const badge = screen.getByTitle(DESCRIPTION);
      expect(badge).toHaveTextContent(/^5days with at least one finished task$/);
      expect(within(badge).getByText("5")).toBeVisible();
      expect(within(badge).getByText("days")).toBeVisible();
      expect(container.textContent).not.toMatch(GUILT);
      expect(screen.queryByLabelText(/streak/i)).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });

    it("says day for one day", () => {
      render(board(1));

      expect(within(screen.getByTitle(DESCRIPTION)).getByText("day")).toBeVisible();
    });

    it.each([0, null])("shows no badge, and no zero, for %s days", (days) => {
      const { container } = render(board(days));

      expect(screen.queryByTitle(DESCRIPTION)).not.toBeInTheDocument();
      expect(container.textContent).not.toMatch(GUILT);
    });

    it("shows the same count as the sidebar, from the one the shell provides", () => {
      render(<AppShell flags={PIVOT} consistencyDays={7}><TaskBoard pivotA /></AppShell>);

      const counts = screen.getAllByTitle(DESCRIPTION);
      expect(counts).toHaveLength(2);
      expect(within(sidebarCard()).getByTitle(DESCRIPTION)).toHaveTextContent(/^7 days$/);
      expect(counts.find((count) => !sidebarCard().contains(count))).toHaveTextContent(/^7days with at least one finished task$/);
    });

    it("keeps the legacy streak badge with Pivot A off, whatever count is provided", () => {
      render(board(5, false));

      expect(screen.getByLabelText("6-day streak. A streak counts consecutive days with at least one completed task.")).toBeVisible();
      expect(screen.getByText("day streak")).toBeVisible();
      expect(screen.queryByTitle(DESCRIPTION)).not.toBeInTheDocument();
    });
  });

  describe("app shell", () => {
    it("shows the count in the sidebar card instead of the streak", async () => {
      const { container } = render(<AppShell flags={PIVOT} consistencyDays={12}><p>Page</p></AppShell>);

      expect(within(sidebarCard()).getByTitle(DESCRIPTION)).toHaveTextContent(/^12 days$/);
      expect(container.textContent).not.toMatch(GUILT);
      expect(await axe(container, axeOptions)).toHaveNoViolations();
    });

    it.each([0, null])("shows no count, and no zero, for %s days", (days) => {
      const { container } = render(<AppShell flags={PIVOT} consistencyDays={days}><p>Page</p></AppShell>);

      expect(within(sidebarCard()).queryByTitle(DESCRIPTION)).not.toBeInTheDocument();
      expect(container.textContent).not.toMatch(GUILT);
    });

    it("keeps the legacy streak with Pivot A off", () => {
      render(<AppShell flags={LEGACY} consistencyDays={12}><p>Page</p></AppShell>);

      expect(within(sidebarCard()).getByText("6-day streak")).toBeInTheDocument();
      expect(within(sidebarCard()).queryByTitle(DESCRIPTION)).not.toBeInTheDocument();
    });
  });

  describe("momentum rail", () => {
    it("shows the count the shell passes down instead of the streak", async () => {
      const { container } = render(<AppShell flags={PIVOT} consistencyDays={3}><MomentumRail /></AppShell>);

      const days = within(momentum()).getByText("Consistency").nextElementSibling;
      expect(days).toHaveTextContent(/^3 days with at least one finished task$/);
      expect(within(momentum()).queryByText("Current streak")).not.toBeInTheDocument();
      expect(momentum().textContent).not.toMatch(GUILT);
      expect(await axe(container, axeOptions)).toHaveNoViolations();
    });

    it.each([0, null])("shows only today's count, and no zero days, for %s days", (days) => {
      render(<AppShell flags={PIVOT} consistencyDays={days}><MomentumRail /></AppShell>);

      expect(within(momentum()).queryByText("Consistency")).not.toBeInTheDocument();
      expect(within(momentum()).queryByText("Current streak")).not.toBeInTheDocument();
      expect(within(momentum()).getByText("Completed today")).toBeVisible();
      expect(momentum().textContent).not.toMatch(GUILT);
    });

    it("keeps the legacy streak with Pivot A off", () => {
      render(<AppShell flags={LEGACY} consistencyDays={3}><MomentumRail /></AppShell>);

      expect(within(momentum()).getByText("Current streak").nextElementSibling).toHaveTextContent(/^6 days$/);
      expect(within(momentum()).queryByText("Consistency")).not.toBeInTheDocument();
    });
  });
});
