import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import "./globals.css";

const appUrl = process.env.APP_URL && /^https?:\/\//.test(process.env.APP_URL)
  ? process.env.APP_URL
  : "http://localhost:3000";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
});

const body = Figtree({
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "idobataAI: small wins, shared well",
    template: "%s · idobataAI",
  },
  description:
    "A private task list and encouraging community for sharing the wins you choose.",
  applicationName: "idobataAI",
  // iOS ignores the web manifest's `display` and `name`, so an installed
  // home-screen icon only opens fullscreen with its own title through these.
  appleWebApp: { capable: true, title: "idobataAI", statusBarStyle: "default" },
  openGraph: {
    type: "website",
    title: "idobataAI: small wins, shared well",
    description: "A private task list and encouraging community for sharing the wins you choose.",
  },
};

// `viewportFit: "cover"` is what makes env(safe-area-inset-*) resolve to a real
// value. Without it the bottom navigation's safe-area padding was always zero,
// so the last row of tap targets sat under the iPhone home indicator.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Matches `--canvas` in both themes so an installed app's status bar and
  // browser chrome do not band against the page behind them.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f2e9" },
    { media: "(prefers-color-scheme: dark)", color: "#070b16" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`} data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
