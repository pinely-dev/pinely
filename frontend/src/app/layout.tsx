import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter_Tight, JetBrains_Mono, League_Gothic } from "next/font/google";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, X_HANDLE } from "@/lib/site";
import { SITE_URL } from "@/lib/site-url";
import { ThemeProvider } from "@/providers/ThemeContext";
import { Web3Provider } from "@/providers/Web3Provider";
import "@rainbow-me/rainbowkit/styles.css";
import "@/index.css";
import "@/pinely.css";

// Self-hosted at build time by next/font: no request to Google at runtime and no layout shift.
const fontSans = Inter_Tight({
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--next-font-sans",
});
const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--next-font-mono",
});
// Tall, narrow capitals for the hero headline only.
const fontDisplay = League_Gothic({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--next-font-display",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0b0b",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  // `./` resolves to the URL of the page being rendered, so every route is its own canonical.
  alternates: { canonical: "./" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    site: X_HANDLE,
    creator: X_HANDLE,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  // Icons come from the file conventions in this folder (icon.png, favicon.ico, apple-icon.png)
  // and from manifest.ts.
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${fontSans.variable} ${fontMono.variable} ${fontDisplay.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-[#000000] text-[#ffffff] antialiased">
        <ThemeProvider>
          <Web3Provider>{children}</Web3Provider>
        </ThemeProvider>
      </body>
    </html>
  );
}
