import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { ShareComposer } from "@/components/social/share-composer";

describe("ShareComposer", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:completion-photo") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  it("uses the saved completion preference and only posts after the button is pressed", () => {
    render(<ShareComposer taskId="preview-task" />);

    expect(screen.getByRole("button", { name: /Only me/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Community/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("link", { name: "Change your default in Settings" })).toHaveAttribute("href", "/settings#privacy");
    expect(screen.queryByText("Your win is posted.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Post privately" }));

    expect(screen.getByText("Your win is posted.")).toBeInTheDocument();
    expect(screen.getByText(/posted privately/)).toBeInTheDocument();
  });

  it("lets the user explicitly choose the community audience for this post", () => {
    render(<ShareComposer taskId="preview-task" />);

    fireEvent.click(screen.getByRole("button", { name: /^Community/ }));
    expect(screen.getByRole("button", { name: /^Community/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Post to Community" }));

    expect(screen.getByText(/posted to the community/)).toBeInTheDocument();
  });

  it("previews a human fallback thought in a compact post when the note is blank", () => {
    render(<ShareComposer taskId="preview-task" />);

    const thought = screen.getByText("Glad to have this one wrapped up.");
    const taskCard = screen.getByText("Draft the project kickoff outline").parentElement;

    expect(thought).toHaveClass("mt-3", "leading-7");
    expect(taskCard).toHaveClass("mt-3", "p-3");
  });

  it("previews and removes optional completion photos before posting", () => {
    render(<ShareComposer taskId="preview-task" />);
    const image = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "finished.png", { type: "image/png" });

    fireEvent.change(screen.getByLabelText("Add photos"), { target: { files: [image] } });

    expect(screen.getByAltText("Selected completion photo 1")).toHaveAttribute("src", "blob:completion-photo");
    expect(screen.getByAltText("Photo attached to Draft the project kickoff outline")).toBeVisible();
    expect(screen.getByText("1 image added. Nothing is posted yet.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
    expect(screen.queryByAltText("Selected completion photo 1")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:completion-photo");
  });
});
