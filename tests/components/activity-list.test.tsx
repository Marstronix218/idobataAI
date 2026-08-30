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

  it("renders one notification list, its unread count, and the shared momentum rail", () => {
    render(<AppTabLayout><ActivityList /></AppTabLayout>);

    expect(screen.getByRole("heading", { name: "Notifications" })).toBeVisible();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByText("7 unread")).toBeVisible();
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

  it("gives a quote notification the same reply, repost, and like controls a post carries in a feed", () => {
    render(<ActivityList />);

    const summary = screen.getByRole("button", { name: /Open notification from Nova Reyes/ });
    const row = summary.closest("article") as HTMLElement;

    expect(within(row).getByRole("button", { name: /Reply/ })).toBeVisible();
    expect(within(row).getByRole("button", { name: /Repost/ })).toBeVisible();
    expect(within(row).getByRole("button", { name: /Like/ })).toBeVisible();
    // The controls sit beside the summary, never inside it: a button nested in a
    // button is invalid markup and swallows the inner click.
    expect(within(summary).queryByRole("button")).not.toBeInTheDocument();
  });

  it("likes the quoting post in place without opening the notification", async () => {
    render(<ActivityList />);

    const row = screen.getByRole("button", { name: /Open notification from Nova Reyes/ }).closest("article") as HTMLElement;
    const like = within(row).getByRole("button", { name: /Like/ });
    expect(like).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(like);

    await waitFor(() => expect(like).toHaveAttribute("aria-pressed", "true"));
    expect(within(row).getByRole("button", { name: "Like 1" })).toBeVisible();
    expect(push).not.toHaveBeenCalled();
  });

  it("reposts the quoting post in place and reports the result", async () => {
    render(<ActivityList />);

    const row = screen.getByRole("button", { name: /Open notification from Nova Reyes/ }).closest("article") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /Repost/ }));

    await waitFor(() => expect(screen.getByText("Reposted. Preview only.")).toBeVisible());
    expect(within(row).getByRole("button", { name: "Repost 1" })).toHaveAttribute("aria-pressed", "true");
    expect(push).not.toHaveBeenCalled();
  });

  it("opens the quoting post's thread from its reply control", () => {
    render(<ActivityList />);

    const row = screen.getByRole("button", { name: /Open notification from Nova Reyes/ }).closest("article") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /Reply/ }));

    expect(push).toHaveBeenCalledWith("/posts/nova-quote");
  });

  it("marks an opened notification read in place and opens the related post", async () => {
    render(<ActivityList />);

    const rows = screen.getAllByRole("button", { name: /Open notification from/ });
    fireEvent.click(rows[0]);

    await waitFor(() => expect(screen.getByText("Notification marked as read. Preview only.")).toBeVisible());
    // The row stays in the list, relabelled as read, rather than disappearing.
    expect(screen.getAllByRole("button", { name: /Open notification from/ })).toHaveLength(5);
    expect(screen.getByRole("button", { name: /Open notification from Moss.*\. Read/ })).toBeVisible();
    expect(push).toHaveBeenCalledWith("/posts/mina-agenda");
  });

  it("marks every notification in a group as read when the group is opened", async () => {
    render(<ActivityList />);

    fireEvent.click(screen.getByRole("button", { name: /Open notification from Jonah Lee and 2 others/ }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/posts/mina-agenda"));
    // All three likes are cleared together, so the group cannot come back unread.
    expect(screen.getByRole("button", { name: /Jonah Lee and 2 others.*\. Read/ })).toBeVisible();
    expect(screen.getByText("4 unread")).toBeVisible();
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
