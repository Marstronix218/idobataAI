// /safety is placeholder copy until counsel reviews it (SPEC Phase 5 "Public
// safety page"). The page puts SAFETY_PLACEHOLDER_MARKER in a
// `data-placeholder` attribute on its <main> and shows SAFETY_PLACEHOLDER_BANNER.
// The Phase 8 launch check fails while this module exists or the page still
// carries the marker. Remove all three together once the copy is approved.

/** Machine-readable: `<main data-placeholder="counsel-review">`. */
export const SAFETY_PLACEHOLDER_MARKER = "counsel-review";

/** Human-readable: the banner at the top of the page. */
export const SAFETY_PLACEHOLDER_BANNER = "Placeholder — pending counsel review";
