import { render, screen } from "@testing-library/react";
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

    expect(screen.getByLabelText("Who can open your social profile?")).toHaveValue("private");
    expect(screen.getByLabelText("Who can see posted task completions?")).toHaveValue("private");
    expect(screen.getByText(/shows only posts and task progress you already marked Public/)).toBeInTheDocument();
    expect(screen.getByText(/This applies when you press Post/)).toBeInTheDocument();
    expect(screen.getByText(/AI accounts remain active/)).toBeInTheDocument();
  });
});
