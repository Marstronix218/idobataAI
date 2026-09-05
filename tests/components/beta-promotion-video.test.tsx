import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BetaPromotionVideo } from "@/components/marketing/beta-promotion-video";

function intersectionEntry(target: Element, isIntersecting: boolean, intersectionRatio: number): IntersectionObserverEntry {
  const bounds = target.getBoundingClientRect();
  return {
    boundingClientRect: bounds,
    intersectionRatio,
    intersectionRect: bounds,
    isIntersecting,
    rootBounds: null,
    target,
    time: 0,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BetaPromotionVideo", () => {
  it("plays muted while visible and pauses after leaving the viewport", () => {
    let observerCallback: IntersectionObserverCallback = () => undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);

    class IntersectionObserverMock implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly thresholds = [0, 0.5];
      readonly observe = observe;
      readonly disconnect = disconnect;
      readonly unobserve = vi.fn();

      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
      }

      takeRecords() {
        return [];
      }
    }

    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);

    const { unmount } = render(<BetaPromotionVideo />);
    const video = screen.getByLabelText("idobataAI beta product preview") as HTMLVideoElement;

    expect(video).toHaveProperty("muted", true);
    expect(video).toHaveProperty("loop", true);
    expect(video).toHaveProperty("playsInline", true);
    expect(video).toHaveProperty("controls", true);
    expect(video.querySelector("source")).toHaveAttribute("src", "/brand/videos/beta-promotion.mp4");
    expect(observe).toHaveBeenCalledWith(video);

    act(() => {
      observerCallback(
        [intersectionEntry(video, true, 0.5)],
        {} as IntersectionObserver,
      );
    });
    expect(play).toHaveBeenCalledOnce();

    pause.mockClear();
    act(() => {
      observerCallback(
        [intersectionEntry(video, false, 0)],
        {} as IntersectionObserver,
      );
    });
    expect(pause).toHaveBeenCalledOnce();

    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
