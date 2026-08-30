import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    // Four likes and reposts on one post fold into two rows, leaving five in all.
    expect(screen.getAllByRole("button", { name: /Open notification from/ })).toHaveLength(5);
  });

  it("folds repeated likes on one post into a single row that names the rest", () => {
    render(<ActivityList />);

    const liked = screen.getByRole("button", { name: /Open notification from Jonah Lee and 2 others/ });

    expect(within(liked).getByText("and 2 others liked your post")).toBeVisible();
    expect(within(liked).getAllByRole("img")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /Open notification from Kage/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open notification from Aya/ })).not.toBeInTheDocument();
  });

  it("folds reposts separately from likes and counts a single other correctly", () => {
    render(<ActivityList />);

    const reposted = screen.getByRole("button", { name: /Open notification from Priya and 1 other/ });

    expect(within(reposted).getByText("and 1 other reposted your post")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Open notification from Leo/ })).not.toBeInTheDocument();
  });

  it("shows a quote notification as the new commentary with the original embedded", () => {
    render(<ActivityList />);

    const quoted = screen.getByRole("button", { name: /Open notification from Nova Reyes/ });

    expect(within(quoted).getByText("quoted your post")).toBeVisible();
    expect(within(quoted).getByText("This is the version of a kickoff doc I keep asking people to write.")).toBeVisible();
    expect(within(quoted).getByText(/Sent the kickoff agenda with three decisions highlighted/)).toBeVisible();
    expect(within(quoted).getByText("Send the kickoff agenda")).toBeVisible();
    // The row is itself a button, so the embedded card must not nest a link.
    expect(within(quoted).queryByRole("link")).not.toBeInTheDocument();
  });

  it("filters to unread notifications, updates read state, and opens the related post", async () => {
    render(<ActivityList />);

    fireEvent.click(screen.getByRole("tab", { name: /Unread/ }));
    expect(screen.getByRole("tab", { name: /Unread/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("idobataAI")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Open notification from/ })[0]);
    await waitFor(() => expect(screen.getByText("Notification marked as read. Preview only.")).toBeVisible());
    expect(screen.getAllByRole("button", { name: /Open notification from/ })).toHaveLength(3);
    expect(push).toHaveBeenCalledWith("/posts/mina-agenda");
  });

  it("marks every notification in a group as read when the group is opened", async () => {
    render(<ActivityList />);

    fireEvent.click(screen.getByRole("tab", { name: /Unread/ }));
    fireEvent.click(screen.getByRole("button", { name: /Open notification from Jonah Lee and 2 others/ }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/posts/mina-agenda"));
    // All three likes leave the unread list together rather than reappearing.
    expect(screen.queryByRole("button", { name: /liked your post/ })).not.toBeInTheDocument();
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

    for (const actor of ["Moss", "Jonah Lee", "Priya", "Nova Reyes"]) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`Open notification from ${actor}`) }));
    }

    await waitFor(() => expect(push).toHaveBeenCalledTimes(4));
    expect(push.mock.calls).toEqual([
      ["/posts/mina-agenda"],
      ["/posts/mina-agenda"],
      ["/posts/mina-agenda"],
      ["/posts/nova-quote"],
    ]);
  });

  it("has no automated accessibility violations", async () => {
    const { container } = render(<ActivityList />);

    expect(await axe(container)).toHaveNoViolations();
  });
});
