import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const auth = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/client/api", () => ({
  errorMessage: (error: unknown) => error instanceof Error ? error.message : "Something went wrong.",
  isPreviewMode: false,
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth }) }));

import { AuthForm } from "@/components/auth/auth-form";

const fetchMock = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Pretends this device is set to `zone`. */
function deviceTimeZone(zone: string) {
  const real = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...real.call(this), timeZone: zone };
  });
}

function fillSignUp({ dateOfBirth }: { dateOfBirth?: string } = {}) {
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "adult@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
  if (dateOfBirth !== undefined) fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value: dateOfBirth } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /Create my private list/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  auth.signUp.mockResolvedValue({ data: { user: { id: "new", identities: [{ id: "identity" }] }, session: { access_token: "token" } }, error: null });
  auth.signInWithPassword.mockResolvedValue({ error: null });
  deviceTimeZone("America/New_York");
});

describe("AuthForm sign-up under Pivot A (age gate)", () => {
  it("asks for a date of birth only under Pivot A", async () => {
    const { container, rerender } = render(<AuthForm mode="signup" pivot />);
    expect(screen.getByLabelText("Date of birth")).toBeRequired();
    expect(screen.getByLabelText("Date of birth")).toHaveAttribute("type", "date");
    expect(await axe(container)).toHaveNoViolations();

    rerender(<AuthForm mode="signup" />);
    expect(screen.queryByLabelText("Date of birth")).not.toBeInTheDocument();

    rerender(<AuthForm mode="login" pivot />);
    expect(screen.queryByLabelText("Date of birth")).not.toBeInTheDocument();
  });

  it("checks the age first, then signs up with the single-use token", async () => {
    fetchMock.mockResolvedValue(json(200, { data: { token: "age-token-abcdefghijklmnop", expiresAt: "2026-10-31T12:15:00.000Z" } }));
    render(<AuthForm mode="signup" pivot />);

    fillSignUp({ dateOfBirth: "1990-05-17" });

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/onboarding"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/age-check");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ dateOfBirth: "1990-05-17", timeZone: "America/New_York" });
    expect(auth.signUp).toHaveBeenCalledWith({
      email: "adult@example.com",
      password: "password123",
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
        data: { age_token: "age-token-abcdefghijklmnop" },
      },
    });
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(auth.signUp.mock.invocationCallOrder[0]);
  });

  it("blocks an under-18 without calling signUp", async () => {
    fetchMock.mockResolvedValue(json(403, { error: { code: "age_requirement", message: "You need to be 18 or older to use idobata." } }));
    const { container } = render(<AuthForm mode="signup" pivot />);

    fillSignUp({ dateOfBirth: "2012-01-01" });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You need to be 18 or older to use idobata.");
    expect(alert).toHaveTextContent("No account was created.");
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows a message for an invalid date and does not sign up", async () => {
    fetchMock.mockResolvedValue(json(422, { error: { code: "invalid_date_of_birth", message: "Enter your real date of birth." } }));
    render(<AuthForm mode="signup" pivot />);

    fillSignUp({ dateOfBirth: "2099-01-01" });

    expect(await screen.findByText("Enter your real date of birth.")).toBeVisible();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it.each([
    [503, { error: { code: "age_verification_unavailable", message: "Age verification is not available right now. Please try again later." } }, "Age verification is not available right now. Please try again later."],
    [429, { error: { code: "rate_limited", message: "You are doing that a little too quickly. Try again shortly." } }, "You are doing that a little too quickly. Try again shortly."],
  ])("does not sign up when the age check answers %s", async (status, body, message) => {
    fetchMock.mockResolvedValue(json(status, body));
    render(<AuthForm mode="signup" pivot />);

    fillSignUp({ dateOfBirth: "1990-05-17" });

    expect(await screen.findByText(message)).toBeVisible();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("does not sign up when the age check cannot be reached", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<AuthForm mode="signup" pivot />);

    fillSignUp({ dateOfBirth: "1990-05-17" });

    expect(await screen.findByText("We could not reach idobata. Check your connection and try again.")).toBeVisible();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("signs up without a token when Pivot A was switched off since the page loaded (404)", async () => {
    fetchMock.mockResolvedValue(json(404, { error: { code: "not_found", message: "Resource not found." } }));
    render(<AuthForm mode="signup" pivot />);

    fillSignUp({ dateOfBirth: "1990-05-17" });

    await waitFor(() => expect(auth.signUp).toHaveBeenCalled());
    expect(auth.signUp.mock.calls[0][0].options).toEqual({ emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` });
  });

  it("explains a token the auth hook rejected and reloads the form", async () => {
    fetchMock.mockResolvedValue(json(200, { data: { token: "age-token-abcdefghijklmnop", expiresAt: "2026-10-31T12:15:00.000Z" } }));
    auth.signUp.mockResolvedValue({ data: { user: null, session: null }, error: Object.assign(new Error("age verification required"), { status: 403 }) });
    render(<AuthForm mode="signup" pivot />);

    fillSignUp({ dateOfBirth: "1990-05-17" });

    expect(await screen.findByText("Your age check didn’t go through. Please try again.")).toBeVisible();
    expect(router.replace).not.toHaveBeenCalled();
    // Reloads the form with fresh flags, in case Pivot A was switched on since the page loaded.
    expect(router.refresh).toHaveBeenCalled();
  });

  it("leaves the legacy sign-up untouched: no age check, no token", async () => {
    render(<AuthForm mode="signup" />);

    fillSignUp();

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/onboarding"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(auth.signUp).toHaveBeenCalledWith({
      email: "adult@example.com",
      password: "password123",
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
    });
  });
});

describe("AuthForm login", () => {
  function logIn() {
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "adult@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: /Log in|Open my feed/ }));
  }

  it("uses a neutral button label under Pivot A, where the feed may be off", () => {
    const { rerender } = render(<AuthForm mode="login" pivot />);
    expect(screen.getByRole("button", { name: /^Log in/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open my feed/ })).not.toBeInTheDocument();

    rerender(<AuthForm mode="login" />);
    expect(screen.getByRole("button", { name: /Open my feed/ })).toBeInTheDocument();
  });

  it("honours a safe ?next= destination", async () => {
    render(<AuthForm mode="login" pivot next="/story?chapter=2" />);

    logIn();

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/story?chapter=2"));
  });

  it.each(["//evil.test/path", "https://evil.test", "/\\evil.test", "/\t/evil.test"])("ignores an unsafe ?next= (%s) and lands on /home", async (next) => {
    render(<AuthForm mode="login" pivot next={next} />);

    logIn();

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/home"));
  });

  it("lands on /home without a destination", async () => {
    render(<AuthForm mode="login" />);

    logIn();

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/home"));
  });
});
