import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { AiDisclosure } from "@/components/coach/ai-disclosure";
import { AI_DISCLOSURE } from "@/lib/domain/ai-disclosure";

// Written out here rather than imported, so a change to the constant fails.
const SPEC_LINE = "AI character · not a person · not a therapist, doctor or lawyer";

describe("AiDisclosure", () => {
  it("exports the spec's line word for word for the reaction engine", () => {
    expect(AI_DISCLOSURE).toBe(SPEC_LINE);
  });

  it("renders exactly the spec's line as a labelled note", async () => {
    const { container } = render(<AiDisclosure />);

    const note = screen.getByRole("note", { name: "AI disclosure" });
    expect(note.textContent).toBe(SPEC_LINE);
    expect(note).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });
});
