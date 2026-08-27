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
