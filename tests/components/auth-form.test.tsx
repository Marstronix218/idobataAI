import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { AuthForm } from "@/components/auth/auth-form";

describe("AuthForm", () => {
  it("does not require a name when creating an account", () => {
    render(<AuthForm mode="signup" />);

    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toBeRequired();
    expect(screen.getByLabelText("Password")).toBeRequired();
  });
});
