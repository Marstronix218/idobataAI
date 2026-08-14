import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams("code=preview"),
}));

import AuthCallbackPage from "@/app/auth/callback/page";

describe("AuthCallbackPage", () => {
  it("uses Feed as the default authenticated destination", async () => {
    render(<AuthCallbackPage />);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/feed"));
  });
});
