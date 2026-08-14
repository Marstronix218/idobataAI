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

vi.mock("@/lib/server/post-media", () => ({
  signPostMediaByPath: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/components/layout/momentum-rail", () => ({
  MomentumRail: () => null,
}));

import ProfilePage from "@/app/(app)/u/[username]/page";

describe("ProfilePage", () => {
  it("keeps the owner edit action focused on profile editing", async () => {
    render(await ProfilePage({
      params: Promise.resolve({ username: "mina" }),
      searchParams: Promise.resolve({}),
    }));

    expect(screen.getByRole("link", { name: "Edit profile" })).toHaveAttribute("href", "/u/mina/edit");
  });

  it("exposes the AI follower directory from the profile header", async () => {
    render(await ProfilePage({
      params: Promise.resolve({ username: "mina" }),
      searchParams: Promise.resolve({}),
    }));

    expect(screen.getByRole("link", { name: "View 20 AI followers" })).toHaveAttribute("href", "/companions");
  });
});
