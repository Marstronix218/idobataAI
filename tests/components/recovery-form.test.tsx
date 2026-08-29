import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
const auth = vi.hoisted(() => ({
  resend: vi.fn().mockResolvedValue({ error: null }),
  resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
  updateUser: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

vi.mock("@/lib/client/api", () => ({
  errorMessage: (error: unknown) => error instanceof Error ? error.message : "Something went wrong.",
  isPreviewMode: false,
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth }) }));

import { RecoveryForm } from "@/components/auth/recovery-form";

describe("RecoveryForm", () => {
  it("requests a PKCE password reset and uses a generic response", async () => {
    render(<RecoveryForm mode="forgot-password" />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "idobata@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Send reset link/ }));

    await waitFor(() => expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("idobata@example.com", {
      redirectTo: `${window.location.origin}/auth/callback?next=/update-password`,
    }));
    expect(screen.getByText("If an account exists for that email, we sent a password reset link.")).toBeInTheDocument();
  });

  it("resends signup confirmation with the onboarding callback", async () => {
    render(<RecoveryForm mode="resend-confirmation" />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "idobata@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Resend confirmation/ }));

    await waitFor(() => expect(auth.resend).toHaveBeenCalledWith({
      type: "signup",
      email: "idobata@example.com",
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
    }));
    expect(screen.getByText("If an unconfirmed account exists for that email, we sent a new confirmation link.")).toBeInTheDocument();
  });

  it("validates password confirmation", () => {
    render(<RecoveryForm mode="update-password" />);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "password-one" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "password-two" } });
    fireEvent.click(screen.getByRole("button", { name: /Save new password/ }));

    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
  });

  it("updates the authenticated user's password", async () => {
    render(<RecoveryForm mode="update-password" />);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "password-one" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "password-one" } });
    fireEvent.click(screen.getByRole("button", { name: /Save new password/ }));

    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ password: "password-one" }));
    expect(router.replace).toHaveBeenCalledWith("/feed");
  });
});
