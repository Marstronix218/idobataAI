import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AvatarPicker } from "@/components/profile/avatar-picker";

describe("AvatarPicker", () => {
  it("passes a selected profile photo to the upload handler", () => {
    const onUpload = vi.fn();
    render(<AvatarPicker value={null} onChange={vi.fn()} initials="MM" onUpload={onUpload} />);
    const file = new File(["avatar"], "avatar.png", { type: "image/png" });

    fireEvent.change(screen.getByLabelText("Upload profile photo"), { target: { files: [file] } });

    expect(onUpload).toHaveBeenCalledWith(file);
  });

  it("shows an uploaded custom photo as the selected choice", () => {
    render(<AvatarPicker value="https://example.com/avatar.png" onChange={vi.fn()} initials="MM" />);

    expect(screen.getByRole("radio", { name: "Your photo" })).toBeChecked();
  });
});
