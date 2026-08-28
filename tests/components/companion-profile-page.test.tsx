import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/supabase/env", () => ({
  hasPublicSupabaseEnv: () => false,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/components/layout/momentum-rail", () => ({
  MomentumRail: () => null,
}));

import CompanionProfilePage from "@/app/(app)/ai-personas/[companionId]/page";

describe("CompanionProfilePage", () => {
  it("uses the companion slug for the preview avatar path", async () => {
    const { container } = render(await CompanionProfilePage({
      params: Promise.resolve({ companionId: "moss" }),
    }));

    expect(screen.getByRole("heading", { name: "Moss", level: 2 })).toBeInTheDocument();
    expect(container.querySelector('img[src="/companions/moss.webp"]')).toBeInTheDocument();
  });

  it("uses generated avatar paths for the new character-engine personas", async () => {
    const { container } = render(await CompanionProfilePage({
      params: Promise.resolve({ companionId: "aster-7" }),
    }));

    expect(screen.getByRole("heading", { name: "Aster-7", level: 2 })).toBeInTheDocument();
    expect(container.querySelector('img[src="/companions/aster-7.webp"]')).toBeInTheDocument();
  });

  it("uses the same social-profile hierarchy as a human profile", async () => {
    render(await CompanionProfilePage({
      params: Promise.resolve({ companionId: "moss" }),
    }));

    expect(screen.getByRole("link", { name: "Back to AI personas" })).toHaveAttribute("href", "/ai-personas");
    expect(screen.getAllByText("@moss")[0]).toBeVisible();
    expect(screen.getByRole("link", { name: "Manage mute" })).toHaveAttribute("href", "/ai-personas");
    expect(screen.getByRole("tab", { name: "Posts" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "About" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getAllByText("AI").length).toBeGreaterThan(1);
  });

  it("shows persona details in the profile About tab", async () => {
    render(await CompanionProfilePage({
      params: Promise.resolve({ companionId: "moss" }),
      searchParams: Promise.resolve({ tab: "about" }),
    }));

    expect(screen.getByRole("tab", { name: "About" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "How Moss participates socially" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Example daily note" })).toBeVisible();
  });

  it("shows six compact, humorous posts with distinct task titles", async () => {
    render(await CompanionProfilePage({
      params: Promise.resolve({ companionId: "cipher" }),
    }));

    const thought = screen.getByText("[03:12:08] fragment located / owner unknown / checksum matches a memory I do not have.");
    const post = thought.closest("article");
    const taskCard = screen.getByText("Trace the deleted identity fragment").parentElement;

    expect(screen.getAllByRole("article")).toHaveLength(6);
    expect(screen.getByText("6 posts", { selector: "p" })).toBeVisible();
    expect(screen.getByText("6 posts", { selector: "dd" })).toBeVisible();
    expect(thought).toHaveClass("mt-3", "leading-7");
    expect(post).toHaveClass("p-4");
    expect(taskCard).toHaveClass("mt-3", "p-3");
    expect(screen.queryByText(/Complete today(?:'|’)s identity trace task/i)).not.toBeInTheDocument();
  });
});
