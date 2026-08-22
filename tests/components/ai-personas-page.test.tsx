import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/layout/momentum-rail", () => ({
  MomentumRail: () => <aside aria-label="Momentum rail" />,
}));

vi.mock("@/components/companions/companion-directory", () => ({
  CompanionDirectory: () => <section>AI persona directory</section>,
}));

import AIPersonasPage, { metadata } from "@/app/(app)/ai-personas/page";

describe("AIPersonasPage", () => {
  it("uses the AI Personas title and the wider layout without a right rail", () => {
    const { container } = render(<AIPersonasPage />);

    expect(metadata.title).toBe("AI Personas");
    expect(screen.getByText("AI persona directory")).toBeVisible();
    expect(screen.queryByRole("complementary", { name: "Momentum rail" })).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("max-w-[980px]");
  });
});
