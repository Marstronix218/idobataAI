import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { openURL } = vi.hoisted(() => ({ openURL: vi.fn<(url: string) => Promise<boolean>>(async () => true) }));

type ShimProps = { children?: ReactNode; accessibilityRole?: string; accessibilityLabel?: string; onPress?: () => void };

// Just enough of react-native for the notice to render as DOM.
vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  return {
    Linking: { openURL },
    Platform: { select: (options: Record<string, unknown>) => options.default },
    StyleSheet: { create: <T,>(styles: T) => styles },
    View: ({ children, accessibilityRole }: ShimProps) => createElement("div", { role: accessibilityRole }, children),
    Text: ({ children, accessibilityRole }: ShimProps) =>
      createElement(accessibilityRole === "header" ? "h2" : "p", null, children),
    Pressable: ({ children, accessibilityLabel, onPress }: ShimProps) =>
      createElement("button", { type: "button", "aria-label": accessibilityLabel, onClick: onPress }, children),
  };
});

import { CrisisNotice } from "../../apps/mobile/src/features/safety/crisis-notice";

describe("mobile crisis notice", () => {
  beforeEach(() => {
    openURL.mockClear();
  });

  it("offers the 988 Lifeline by call or text and 911 for immediate danger, and nothing else", () => {
    render(<CrisisNotice onDismiss={vi.fn()} />);

    // The mobile tsconfig has no jest-dom types, so plain DOM checks.
    const notice = screen.getByRole("alert");
    expect(screen.getByRole("heading", { name: "988 Suicide & Crisis Lifeline" }).textContent).toBe("988 Suicide & Crisis Lifeline");
    expect(notice.textContent).toBe(
      "988 Suicide & Crisis LifelineCall or text 988.Call 988Text 988For immediate danger, call 911.Call 911Dismiss",
    );

    fireEvent.click(screen.getByRole("button", { name: "Call 988" }));
    fireEvent.click(screen.getByRole("button", { name: "Text 988" }));
    fireEvent.click(screen.getByRole("button", { name: "Call 911" }));
    expect(openURL.mock.calls.map(([url]) => url)).toEqual(["tel:988", "sms:988", "tel:911"]);
  });

  it("can be dismissed", () => {
    const onDismiss = vi.fn();
    render(<CrisisNotice onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss crisis resources" }));

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(openURL).not.toHaveBeenCalled();
  });

  it("swallows a failed open, e.g. on a device that can't call", async () => {
    openURL.mockRejectedValueOnce(new Error("no handler"));
    render(<CrisisNotice onDismiss={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Call 911" }));
    await Promise.resolve();

    expect(openURL).toHaveBeenCalledWith("tel:911");
  });
});
