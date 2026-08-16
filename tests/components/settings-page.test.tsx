import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/layout/momentum-rail", () => ({
  MomentumRail: () => <aside aria-label="Momentum rail" />,
}));

vi.mock("@/components/settings/settings-panel", () => ({
  SettingsPanel: () => <section>Settings panel</section>,
}));

import SettingsPage from "@/app/(app)/settings/page";

describe("SettingsPage", () => {
  it("uses the wider tab layout without the right context rail", () => {
    const { container } = render(<SettingsPage />);

    expect(screen.getByText("Settings panel")).toBeVisible();
    expect(screen.queryByRole("complementary", { name: "Momentum rail" })).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("max-w-[980px]");
  });
});
