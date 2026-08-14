import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
}));

vi.mock("@/lib/supabase/env", () => ({
  hasPublicSupabaseEnv: () => false,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import CompanionProfilePage from "@/app/(app)/companions/[companionId]/page";

describe("CompanionProfilePage", () => {
  it("uses the companion slug for the preview avatar path", async () => {
    const { container } = render(await CompanionProfilePage({
      params: Promise.resolve({ companionId: "moss" }),
    }));

    expect(screen.getByRole("heading", { name: "Moss" })).toBeInTheDocument();
    expect(container.querySelector('img[src="/companions/moss.webp"]')).toBeInTheDocument();
  });
});
