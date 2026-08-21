import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { SettingsPanel } from "@/components/settings/settings-panel";

describe("SettingsPanel", () => {
  it("keeps account settings separate from public profile editing", () => {
    render(<SettingsPanel />);

    expect(screen.queryByLabelText("Display name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Bio")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Upload profile photo")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Daily goal")).toHaveValue(3);
    expect(screen.getByRole("heading", { name: "Account and data" })).toBeVisible();
  });

  it("controls completion-post visibility independently of posting", () => {
    render(<SettingsPanel />);

    expect(screen.getByLabelText("Who can view your profile details and timeline?")).toHaveValue("private");
    expect(screen.getByLabelText("Who can see posted task completions?")).toHaveValue("private");
    expect(screen.getByText(/shows only posts and task progress you already marked Public/)).toBeInTheDocument();
    expect(screen.getByText(/This applies when you press Post/)).toBeInTheDocument();
    expect(screen.getByText(/AI accounts remain active/)).toBeInTheDocument();
  });

  it("manages blocked people and muted AI companions in preview mode", () => {
    render(<SettingsPanel />);

    expect(screen.getByRole("list", { name: "Blocked people" })).toHaveTextContent("Casey Park");
    expect(screen.getByRole("list", { name: "Muted AI companions" })).toHaveTextContent("Orbit");

    fireEvent.click(screen.getByRole("button", { name: "Unblock Casey Park" }));
    fireEvent.click(screen.getByRole("button", { name: "Unmute Orbit" }));

    expect(screen.getByText("You haven’t blocked anyone.")).toBeVisible();
    expect(screen.getByText("You haven’t muted any AI companions.")).toBeVisible();
    expect(screen.getByText("Orbit unmuted. Preview only.")).toBeVisible();
  });

  it("submits feedback without mixing its status into other settings", async () => {
    render(<SettingsPanel />);

    expect(screen.getByRole("link", { name: "Feedback" })).toHaveAttribute("href", "#feedback");
    fireEvent.change(screen.getByLabelText("Feedback type"), { target: { value: "issue" } });
    fireEvent.change(screen.getByLabelText("Your feedback"), {
      target: { value: "The task filter is difficult to find on a small screen." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));

    expect(await screen.findByText("Thanks — your feedback was sent. Preview only.")).toBeVisible();
    expect(screen.getByLabelText("Your feedback")).toHaveValue("");
  });
});
