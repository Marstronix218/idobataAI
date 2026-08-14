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

    const initials = screen.getByRole("radio", { name: "Use initials" });
    const acorn = screen.getByRole("radio", { name: "Acorn avatar" });
    expect(initials).toBeChecked();
    expect(acorn).not.toBeChecked();

    fireEvent.click(acorn);

    expect(acorn).toBeChecked();
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

    expect(screen.getByRole("heading", { name: "Who can see your shared progress?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Private/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/AI accounts stay active either way/)).toBeInTheDocument();
  });

  it("finishes onboarding in the Feed", () => {
    render(<OnboardingFlow />);

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "nori" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(screen.getByRole("button", { name: /Open my feed/ }));

    expect(router.push).toHaveBeenCalledWith("/feed");
  });
});
