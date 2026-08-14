import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Avatar } from "@/components/ui/avatar";

describe("Avatar", () => {
  it("renders a selected avatar with an accessible name", () => {
    render(<Avatar initials="NS" avatarUrl="/avatars/sprout.png" name="Nori's avatar" />);

    const avatar = screen.getByRole("img", { name: "Nori's avatar" });
    expect(avatar).toHaveTextContent("NS");
    expect(avatar.querySelector("img")).toHaveAttribute("src", "/avatars/sprout.png");
  });

  it("falls back to initials when the avatar image fails to load", () => {
    render(<Avatar initials="NS" avatarUrl="/avatars/missing.png" name="Nori's avatar" />);
    const avatar = screen.getByRole("img", { name: "Nori's avatar" });

    fireEvent.error(avatar.querySelector("img")!);

    expect(avatar).toHaveTextContent("NS");
    expect(avatar.querySelector("img")).not.toBeInTheDocument();
  });

  it("renders initials when no avatar is selected", () => {
    const { container } = render(<Avatar initials="NS" />);

    expect(container.firstChild).toHaveTextContent("NS");
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });
});
