import "@testing-library/jest-dom/vitest";

import { cleanup, configure } from "@testing-library/react";
import { toHaveNoViolations } from "jest-axe";
import { afterEach, expect, vi } from "vitest";

process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE = "true";

// Route handlers now read flags through the server-only `@/lib/flags`. The
// marker only means something to the Next bundler, and its default export
// throws outside a React Server Components build.
vi.mock("server-only", () => ({}));

// findBy* and waitFor give up after 1s by default, which a loaded CI runner can exceed
// for a render that takes milliseconds alone. A passing wait still returns at once.
configure({ asyncUtilTimeout: 5000 });

expect.extend(toHaveNoViolations);

afterEach(() => {
  cleanup();
});

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class ResizeObserverStub implements ResizeObserver {
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
}

globalThis.ResizeObserver = ResizeObserverStub;
