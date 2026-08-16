import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { ActivityList } from "@/components/activity/activity-list";
import { AppTabLayout } from "@/components/layout/app-tab-layout";

describe("ActivityList", () => {
  beforeEach(() => push.mockReset());

  it("renders the X-style notification views and shared momentum rail", () => {
    render(<AppTabLayout><ActivityList /></AppTabLayout>);

    expect(screen.getByRole("heading", { name: "Notifications" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Unread/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("complementary", { name: "Today and performance" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Your Tasks" })).toHaveAttribute("href", "/tasks");
    expect(screen.getAllByRole("button", { name: /Open notification from/ })).toHaveLength(4);
  });

  it("filters to unread notifications, updates read state, and opens the related post", async () => {
    render(<ActivityList />);

    fireEvent.click(screen.getByRole("tab", { name: /Unread/ }));
    expect(screen.getByRole("tab", { name: /Unread/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("idobataAI")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Open notification from/ })[0]);
    await waitFor(() => expect(screen.getByText("Notification marked as read. Preview only.")).toBeVisible());
    expect(screen.getAllByRole("button", { name: /Open notification from/ })).toHaveLength(2);
    expect(push).toHaveBeenCalledWith("/posts/mina-agenda");
  });

  it("supports arrow-key navigation between notification tabs", () => {
    render(<ActivityList />);
    const allTab = screen.getByRole("tab", { name: "All" });

    allTab.focus();
    fireEvent.keyDown(allTab, { key: "ArrowRight" });

    expect(screen.getByRole("tab", { name: /Unread/ })).toHaveAttribute("aria-selected", "true");
  });

  it("opens every post notification on the post it describes", async () => {
    render(<ActivityList />);

    for (const actor of ["Moss", "Jonah Lee", "Tempo"]) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`Open notification from ${actor}`) }));
    }

    await waitFor(() => expect(push).toHaveBeenCalledTimes(3));
    expect(push.mock.calls).toEqual([
      ["/posts/mina-agenda"],
      ["/posts/mina-agenda"],
      ["/posts/mina-agenda"],
    ]);
  });

  it("has no automated accessibility violations", async () => {
    const { container } = render(<ActivityList />);

    expect(await axe(container)).toHaveNoViolations();
  });
});
