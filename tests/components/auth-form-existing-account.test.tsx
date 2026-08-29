import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const auth = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
  signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
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

import { AuthForm } from "@/components/auth/auth-form";

function submitSignUp(email = "idobata@example.com") {
  render(<AuthForm mode="signup" />);
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /Create my private list/ }));
}

describe("AuthForm signup for an email that already has an account", () => {
  it("sends the person to log in when Supabase obfuscates the duplicate", async () => {
    // Email enumeration protection on: no error, no session, and a user with
    // no identities — the only signal that the address is already taken.
    auth.signUp.mockResolvedValue({ data: { user: { id: "obfuscated", identities: [] }, session: null }, error: null });
    submitSignUp();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You already have an account.");
    expect(screen.getByRole("link", { name: /Log in instead/ }))
      .toHaveAttribute("href", "/login?email=idobata%40example.com");
    expect(screen.queryByText("Check your email to confirm your account, then log in.")).not.toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("does the same when Supabase reports the duplicate outright", async () => {
    auth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: Object.assign(new Error("User already registered"), { code: "user_already_exists" }),
    });
    submitSignUp();

    expect(await screen.findByRole("alert")).toHaveTextContent("You already have an account.");
  });

  it("still asks a genuinely new signup to confirm their email", async () => {
    auth.signUp.mockResolvedValue({
      data: { user: { id: "new-user", identities: [{ id: "identity" }] }, session: null },
      error: null,
    });
    submitSignUp("idobata@example.com");

    await waitFor(() =>
      expect(screen.getByText("Check your email to confirm your account, then log in.")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces unrelated signup failures as before", async () => {
    auth.signUp.mockResolvedValue({ data: { user: null, session: null }, error: new Error("Password is too weak") });
    submitSignUp();

    await waitFor(() => expect(screen.getByText("Password is too weak")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
