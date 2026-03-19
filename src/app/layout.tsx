"use client";

import { Sora, DM_Sans, JetBrains_Mono } from "next/font/google";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { useState } from "react";
import { wagmiConfig } from "@/config/wagmi";
import { IdentityProvider } from "@/contexts/IdentityContext";
import { ProofProvider } from "@/contexts/ProofContext";
import "@rainbow-me/rainbowkit/styles.css";
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
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: 2,
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: 1,
          },
        },
      }),
  );

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
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
        >
          <WagmiProvider config={wagmiConfig}>
            <QueryClientProvider client={queryClient}>
              <RainbowKitProvider
                theme={darkTheme({
                  accentColor: "#c0c4cc",
                  accentColorForeground: "#08090b",
                  borderRadius: "large",
                  fontStack: "system",
                  overlayBlur: "small",
                })}
                modalSize="compact"
              >
                <IdentityProvider>
                  <ProofProvider>
                    {children}
                    <Toaster
                      position="bottom-right"
                      toastOptions={{
                        className: "font-body",
                        style: {
                          background: "rgba(14, 15, 18, 0.95)",
                          backdropFilter: "blur(24px)",
                          border: "1px solid rgba(255, 255, 255, 0.07)",
                          color: "#eceef1",
                          borderRadius: "16px",
                          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
                        },
                      }}
                    />
                  </ProofProvider>
                </IdentityProvider>
              </RainbowKitProvider>
            </QueryClientProvider>
          </WagmiProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
