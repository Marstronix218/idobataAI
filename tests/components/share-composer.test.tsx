import { fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
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

  it("composes the win as a comment above a quoted completed task", () => {
    render(<ShareComposer taskId="preview-task" />);

    const composer = screen.getByRole("region", { name: "Post your completed task" });
    const quotedTask = within(composer).getByRole("article", {
      name: "Quoted completed task: Draft the project kickoff outline",
    });
    const submit = within(composer).getByRole("button", { name: "Post privately" });

    expect(within(composer).getByRole("heading", { name: "Post a win" })).toBeVisible();
    expect(within(composer).getByLabelText("Comment on your completed task")).toHaveAttribute(
      "placeholder",
      "Add a comment about this win",
    );
    expect(within(quotedTask).getByText("Draft the project kickoff outline")).toBeVisible();
    expect(within(quotedTask).getByText("Your completed task")).toBeVisible();
    expect(submit.closest("header")).not.toBeNull();
    expect(screen.queryByText("Tell the story")).not.toBeInTheDocument();
    expect(screen.queryByText("Post preview")).not.toBeInTheDocument();
  });

  it("lets the user explicitly choose the community audience for this post", () => {
    render(<ShareComposer taskId="preview-task" />);

    fireEvent.click(screen.getByRole("button", { name: /^Community/ }));
    expect(screen.getByRole("button", { name: /^Community/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Post to Community" }));

    expect(screen.getByText(/posted to the community/)).toBeInTheDocument();
  });

  it("keeps the comment optional without promising fallback text", () => {
    render(<ShareComposer taskId="preview-task" />);

    expect(screen.getByLabelText("Comment on your completed task")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Post privately" })).toBeEnabled();
    expect(screen.queryByText(/Leave it blank and we’ll use/)).not.toBeInTheDocument();
  });

  it("previews and removes optional completion photos before posting", () => {
    render(<ShareComposer taskId="preview-task" />);
    const image = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "finished.png", { type: "image/png" });

    fireEvent.change(screen.getByLabelText("Add photos"), { target: { files: [image] } });

    expect(screen.getByAltText("Selected completion photo 1")).toHaveAttribute("src", "blob:completion-photo");
    expect(screen.getByRole("article", { name: "Quoted completed task: Draft the project kickoff outline" })).toBeVisible();
    expect(screen.getByText("1 image added. Nothing is posted yet.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
    expect(screen.queryByAltText("Selected completion photo 1")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:completion-photo");
  });

  it("has no automated accessibility violations", async () => {
    const { container } = render(<ShareComposer taskId="preview-task" />);

    expect(await axe(container)).toHaveNoViolations();
  });
});
