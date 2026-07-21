import { Sora, DM_Sans, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";

import { AppProviders } from "./providers";
import "@/styles/globals.css";

// A nonce-based CSP is generated per request by middleware. Rendering pages at
// request time lets Next.js attach that nonce to its inline bootstrap scripts;
// statically prerendered HTML cannot carry a request-specific nonce.
export const dynamic = "force-dynamic";

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
  weight: ["400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500"],
});

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = (await headers()).get("x-nonce") || undefined;

  return (
    <html
      lang="en"
      className={`${sora.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta
          name="description"
          content="ZeroID — Self-sovereign identity with zero-knowledge proofs and TEE verification on the Aethelred network"
        />
        <meta name="theme-color" content="#08090b" />
        <link rel="icon" type="image/png" href="/zeroid-logo.png" />
        <title>ZeroID | Self-Sovereign Identity</title>
      </head>
      <body className="font-body min-h-screen bg-[var(--surface-primary)]">
        <AppProviders nonce={nonce}>{children}</AppProviders>
      </body>
    </html>
  );
}
