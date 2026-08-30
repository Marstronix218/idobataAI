import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";

describe("OnboardingFlow", () => {
  it("keeps typed username text offset from the @ prefix", () => {
    render(<OnboardingFlow />);
    const username = screen.getByLabelText("Username");

    expect(username).toHaveClass("field-prefixed");
    expect(username.parentElement).toHaveTextContent("@");

    fireEvent.change(username, { target: { value: "someone" } });

    expect(username).toHaveValue("someone");
  });

  it("replaces avatar URL entry with optional preset choices", () => {
    render(<OnboardingFlow />);

    expect(screen.queryByLabelText(/Avatar URL/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Add avatar URL/i)).not.toBeInTheDocument();

    const initials = screen.getByRole("radio", { name: "Initials" });
    const kuro = screen.getByRole("radio", { name: "Kuro" });
    expect(screen.getByRole("radio", { name: "Mika" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Riku" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Suzu" })).not.toBeChecked();
    expect(initials).toBeChecked();
    expect(kuro).not.toBeChecked();

    fireEvent.click(kuro);

    expect(kuro).toBeChecked();
    expect(initials).not.toBeChecked();
  });

  it("updates the initials fallback as the username changes", () => {
    render(<OnboardingFlow />);

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "nori" } });

    expect(screen.getByText("NO")).toBeInTheDocument();
  });

  it("offers a completion-post privacy choice during onboarding", () => {
    render(<OnboardingFlow />);

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "nori" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    expect(screen.getByRole("heading", { name: "Who can open your profile?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Private/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Signed-in members can still see your basic profile/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Default audience for posted wins" })).toBeInTheDocument();
  });

  it("does not save interests the user did not choose", () => {
    render(<OnboardingFlow />);

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "nori" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    expect(screen.getByText("0 selected · You can change these later.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Work" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Learning" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Wellbeing" })).toHaveAttribute("aria-pressed", "false");
  });

  // Onboarding ends on the task board, not the feed: the landing page promises
  // "start with one private task", and finishing setup on a feed of strangers
  // left the user with nothing of their own and a second tab to find.
  it("finishes onboarding on the task board", () => {
    render(<OnboardingFlow />);

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "nori" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(screen.getByRole("button", { name: /Set up my first task/ }));

    expect(router.push).toHaveBeenCalledWith("/tasks");
  });

  it("asks about profile visibility and post audience as separate choices", () => {
    render(<OnboardingFlow />);

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "nori" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    // A private profile must not silently also mean every win you post is
    // visible only to you -- that combination published nothing to anyone.
    expect(screen.getByRole("button", { name: /Private/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /The community/ })).toHaveAttribute("aria-pressed", "true");
  });
});
