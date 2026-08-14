import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { ProfileEditor } from "@/components/profile/profile-editor";

describe("ProfileEditor", () => {
  it("edits only the public-facing profile fields", () => {
    render(<ProfileEditor />);

    expect(screen.getByRole("heading", { name: "Edit profile" })).toBeVisible();
    expect(screen.getByLabelText("Display name")).toHaveValue("Mina Mori");
    expect(screen.getByLabelText("Username")).toHaveValue("mina");
    expect(screen.getByLabelText("Bio")).toHaveValue("Building calmer routines, one honest win at a time.");
    expect(screen.getByLabelText("Interests")).toHaveValue("Work, Learning, Wellbeing");
    expect(screen.getByLabelText("Upload profile photo")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");

    expect(screen.queryByLabelText("Daily goal")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Who can open your social profile?")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Notifications" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete account" })).not.toBeInTheDocument();
  });
});
