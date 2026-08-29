import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { ChatPanel } from "@/components/chat/chat-panel";

describe("ChatPanel", () => {
  it("renders an X-style inbox and clearly labels AI conversations", () => {
    render(<ChatPanel />);

    expect(screen.getByRole("heading", { name: "Chat" })).toBeVisible();
    expect(screen.getByLabelText("Chat inbox")).toBeInTheDocument();
    expect(screen.getByLabelText("Conversation with Moss")).toBeInTheDocument();
    expect(screen.getAllByText("AI", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText("Search conversations")).toBeVisible();
  });

  it("sends a preview message and receives a labeled AI response", () => {
    render(<ChatPanel />);
    const composer = screen.getByLabelText("Message Moss");

    fireEvent.change(composer, { target: { value: "How should I start?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(screen.getByText("How should I start?")).toBeVisible();
    expect(screen.getAllByText(/What would a kind, workable next step/)).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("Moss replied. Preview only.");
  });

  it("starts chats with both people and AI profiles", () => {
    render(<ChatPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Start a new conversation" }));
    expect(screen.getByRole("dialog", { name: "New conversation" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "People" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "AI profiles" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Aya Chen/ }));
    expect(screen.getByLabelText("Conversation with Aya Chen")).toBeInTheDocument();
    expect(screen.getByLabelText("Message Aya Chen")).toBeVisible();
  });

  it("keeps both search fields clear of their decorative icons", () => {
    const { container } = render(<ChatPanel />);

    expect(screen.getByPlaceholderText("Search conversations")).toHaveClass("field-prefixed");

    fireEvent.click(screen.getByRole("button", { name: "Start a new conversation" }));
    expect(screen.getByPlaceholderText("Search people and AI profiles")).toHaveClass("field-prefixed");

    const searchIconWrappers = Array.from(container.querySelectorAll(".lucide-search")).map((icon) => icon.parentElement);
    expect(searchIconWrappers.every((wrapper) => wrapper?.classList.contains("inset-y-0"))).toBe(true);
  });

  it("has no automated accessibility violations", async () => {
    const { container } = render(<ChatPanel />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
