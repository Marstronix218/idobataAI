import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AvatarPicker } from "@/components/profile/avatar-picker";

describe("AvatarPicker", () => {
  it("shows character images without visible option names", () => {
    render(<AvatarPicker value={null} onChange={vi.fn()} initials="MM" />);

    for (const name of ["Kuro", "Mika", "Riku", "Suzu"]) {
      const radio = screen.getByRole("radio", { name });
      expect(radio.closest("label")?.querySelector("img")).toHaveAttribute(
        "src",
        expect.stringContaining(encodeURIComponent(`/avatars/${name.toLowerCase()}.png`)),
      );
      expect(screen.queryByText(name)).not.toBeInTheDocument();
    }
  });

  it("opens the file picker when the displayed profile photo is activated", () => {
    render(<AvatarPicker value={null} onChange={vi.fn()} initials="MM" onUpload={vi.fn()} />);
    const fileInput = screen.getByLabelText("Upload profile photo");
    const openFilePicker = vi.spyOn(fileInput, "click");

    fireEvent.click(screen.getByRole("button", { name: "Change profile photo" }));

    expect(openFilePicker).toHaveBeenCalledOnce();
  });

  it("passes a selected profile photo to the upload handler", () => {
    const onUpload = vi.fn();
    render(<AvatarPicker value={null} onChange={vi.fn()} initials="MM" onUpload={onUpload} />);
    const file = new File(["avatar"], "avatar.png", { type: "image/png" });

    fireEvent.change(screen.getByLabelText("Upload profile photo"), { target: { files: [file] } });

    expect(onUpload).toHaveBeenCalledWith(file);
  });

  it("keeps the camera affordance visible on the profile photo", () => {
    render(<AvatarPicker value={null} onChange={vi.fn()} initials="MM" onUpload={vi.fn()} />);

    expect(screen.getByTestId("profile-photo-camera-overlay")).toBeVisible();
  });

  it("shows an uploaded custom photo as the selected choice", () => {
    render(<AvatarPicker value="https://example.com/avatar.png" onChange={vi.fn()} initials="MM" />);

    expect(screen.getByRole("radio", { name: "Your photo" })).toBeChecked();
  });
});
