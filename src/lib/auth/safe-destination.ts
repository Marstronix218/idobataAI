// /home redirects by flags: the feed today, onboarding or tasks under Pivot A.
export const DEFAULT_DESTINATION = "/home";

const BASE = "https://idobata.invalid";

/**
 * A same-origin path to go to after signing in, or /home. Rejects absolute
 * and protocol-relative URLs, backslashes (which browsers treat as `/`), and
 * whitespace or control characters: URL parsing strips tabs and newlines, so
 * `/\t/evil.test` would otherwise become `//evil.test`. The path is returned
 * normalised, and rejected if dot segments (`/..//evil.test`) make it start
 * with `//`.
 */
export function safeDestination(value: string | null | undefined) {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\s\p{Cc}]/u.test(value)) return DEFAULT_DESTINATION;
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE || url.pathname.startsWith("//")) return DEFAULT_DESTINATION;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_DESTINATION;
  }
}
