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

import { AuthForm } from "@/components/auth/auth-form";

describe("AuthForm", () => {
  it("does not require a name when creating an account", () => {
    render(<AuthForm mode="signup" />);

    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toBeRequired();
    expect(screen.getByLabelText("Password")).toBeRequired();
  });

  it("opens the Feed after a returning user signs in", () => {
    render(<AuthForm mode="login" />);

    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "mina@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: /Open my feed/ }));

    expect(router.push).toHaveBeenCalledWith("/feed");
  });

  it("links users to password recovery and confirmation resend", () => {
    const { rerender } = render(<AuthForm mode="login" />);
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/forgot-password");

    rerender(<AuthForm mode="signup" />);
    expect(screen.getByRole("link", { name: "Resend confirmation email" })).toHaveAttribute("href", "/resend-confirmation");
  });
});
