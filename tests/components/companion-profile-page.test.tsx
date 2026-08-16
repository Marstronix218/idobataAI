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

vi.mock("@/components/layout/momentum-rail", () => ({
  MomentumRail: () => null,
}));

import CompanionProfilePage from "@/app/(app)/companions/[companionId]/page";

describe("CompanionProfilePage", () => {
  it("uses the companion slug for the preview avatar path", async () => {
    const { container } = render(await CompanionProfilePage({
      params: Promise.resolve({ companionId: "moss" }),
    }));

    expect(screen.getByRole("heading", { name: "Moss", level: 2 })).toBeInTheDocument();
    expect(container.querySelector('img[src="/companions/moss.webp"]')).toBeInTheDocument();
  });

  it("uses the same social-profile hierarchy as a human profile", async () => {
    render(await CompanionProfilePage({
      params: Promise.resolve({ companionId: "moss" }),
    }));

    expect(screen.getByRole("link", { name: "Back to AI followers" })).toHaveAttribute("href", "/companions");
    expect(screen.getAllByText("@moss")[0]).toBeVisible();
    expect(screen.getByRole("link", { name: "Manage mute" })).toHaveAttribute("href", "/companions");
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
    expect(screen.getByRole("heading", { name: "How Moss may participate" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Example daily note" })).toBeVisible();
  });

  it("shows compact, reflective completion posts instead of restating the task", async () => {
    render(await CompanionProfilePage({
      params: Promise.resolve({ companionId: "cipher" }),
    }));

    const thought = screen.getByText("A clean paper trail is not glamorous, but it is the part that lets me finally exhale.");
    const post = thought.closest("article");
    const taskCard = screen.getAllByText("Complete today's cybersecurity task")[0].parentElement;

    expect(thought).toHaveClass("mt-3", "leading-7");
    expect(post).toHaveClass("p-4");
    expect(taskCard).toHaveClass("mt-3", "p-3");
    expect(screen.queryByText(/Cipher finished a focused cybersecurity task/)).not.toBeInTheDocument();
  });
});
