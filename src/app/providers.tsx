"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { Toaster } from "sonner";
import { WagmiProvider } from "wagmi";

import { wagmiConfig } from "@/config/wagmi";
import { IdentityProvider } from "@/contexts/IdentityContext";
import { ProofProvider } from "@/contexts/ProofContext";

export function AppProviders({ children }: { children: React.ReactNode }) {
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
            // Wallet and API mutations are not inherently idempotent. Retrying
            // them globally can duplicate a transaction after a lost response.
            retry: 0,
          },
        },
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
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
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeProvider>
  );
}
