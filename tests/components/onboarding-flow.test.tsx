import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
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
});
