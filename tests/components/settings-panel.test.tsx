import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { SettingsPanel } from "@/components/settings/settings-panel";

describe("SettingsPanel", () => {
  it("uses the avatar picker instead of a URL field", () => {
    render(<SettingsPanel />);

    expect(screen.queryByLabelText(/Avatar URL/i)).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Use initials" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Sprout avatar" })).toBeInTheDocument();
  });
});
