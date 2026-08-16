import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { screen } from "@testing-library/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RelativeTime, formatRelativeTime } from "@/components/ui/relative-time";

describe("RelativeTime", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("formats elapsed time at useful boundaries", () => {
    const now = Date.parse("2026-08-14T12:00:00.000Z");

    expect(formatRelativeTime("2026-08-14T11:59:40.000Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-08-14T11:52:00.000Z", now)).toBe("8m ago");
    expect(formatRelativeTime("2026-08-14T09:00:00.000Z", now)).toBe("3h ago");
    expect(formatRelativeTime("2026-08-12T12:00:00.000Z", now)).toBe("2d ago");
  });

  it("hydrates without a mismatch when server and client timestamps cross a minute boundary", async () => {
    const now = Date.now();
    const serverValue = new Date(now - 8 * 60_000).toISOString();
    const container = document.createElement("div");
    container.innerHTML = renderToString(<RelativeTime value={serverValue} />);
    document.body.append(container);

    const clientValue = new Date(now - 8 * 60_000 - 200).toISOString();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const recoverableError = vi.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;

    await act(async () => {
      root = hydrateRoot(container, <RelativeTime value={clientValue} />, {
        onRecoverableError: recoverableError,
      });
    });

    expect(error).not.toHaveBeenCalled();
    expect(recoverableError).not.toHaveBeenCalled();
    expect(screen.getByText("8m ago")).toBeInTheDocument();
    expect(screen.getByText("8m ago")).toHaveAttribute("datetime", clientValue);

    await act(async () => root?.unmount());
    error.mockRestore();
  });
});
