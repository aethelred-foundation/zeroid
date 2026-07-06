import { Sora, DM_Sans, JetBrains_Mono } from "next/font/google";

import { AppProviders } from "./providers";
import "@/styles/globals.css";

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
        <link rel="icon" href="/favicon.ico" />
        <title>ZeroID | Self-Sovereign Identity</title>
      </head>
      <body className="font-body min-h-screen bg-[var(--surface-primary)]">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
