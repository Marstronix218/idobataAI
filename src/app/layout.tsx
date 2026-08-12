import type { Metadata } from "next";
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
    default: "idobataAI — small wins, shared well",
    template: "%s · idobataAI",
  },
  description:
    "A private task list and encouraging community for sharing the wins you choose.",
  openGraph: {
    type: "website",
    title: "idobataAI — small wins, shared well",
    description: "A private task list and encouraging community for sharing the wins you choose.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
