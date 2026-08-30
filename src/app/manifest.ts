import type { MetadataRoute } from "next";

// The shell is already installable-shaped - a bottom navigation bar and
// safe-area insets tuned down to 320px - so a manifest is what turns the beta
// into a home-screen app while a native iOS build is still only on the roadmap.
// `start_url` points at the feed because the authenticated layout redirects
// signed-out visitors to /login anyway, so an installed icon lands a returning
// user on the loop rather than on the marketing page.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "idobataAI: small wins, shared well",
    short_name: "idobataAI",
    description: "A private task list and encouraging community for sharing the wins you choose.",
    start_url: "/feed",
    scope: "/",
    display: "standalone",
    background_color: "#f7f2e9",
    theme_color: "#f7f2e9",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android crops adaptive icons to its own mask, so the maskable variant
      // is the mark inset to 80% on the canvas colour to survive the crop.
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
