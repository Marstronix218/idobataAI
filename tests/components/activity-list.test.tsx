import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { ActivityList } from "@/components/activity/activity-list";
import { AppTabLayout } from "@/components/layout/app-tab-layout";

describe("ActivityList", () => {
  it("renders the X-style notification views and shared momentum rail", () => {
    render(<AppTabLayout><ActivityList /></AppTabLayout>);

    expect(screen.getByRole("heading", { name: "Notifications" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Unread/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("complementary", { name: "Today and performance" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Your Tasks" })).toHaveAttribute("href", "/tasks");
    expect(screen.getAllByRole("button", { name: /Mark notification from/ })).toHaveLength(3);
  });

  it("filters to unread notifications and updates read state", () => {
    render(<ActivityList />);

    fireEvent.click(screen.getByRole("tab", { name: /Unread/ }));
    expect(screen.getByRole("tab", { name: /Unread/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("idobataAI")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Mark notification from/ })[0]);
    expect(screen.getByText("Notification marked as read. Preview only.")).toBeVisible();
    expect(screen.getAllByRole("button", { name: /Mark notification from/ })).toHaveLength(2);
  });

  it("supports arrow-key navigation between notification tabs", () => {
    render(<ActivityList />);
    const allTab = screen.getByRole("tab", { name: "All" });

    allTab.focus();
    fireEvent.keyDown(allTab, { key: "ArrowRight" });

    expect(screen.getByRole("tab", { name: /Unread/ })).toHaveAttribute("aria-selected", "true");
  });

  it("has no automated accessibility violations", async () => {
    const { container } = render(<ActivityList />);

    expect(await axe(container)).toHaveNoViolations();
  });
});
