"use client";

import { usePathname } from "next/navigation";
import { Search, Menu, Command } from "lucide-react";

import { WalletButton } from "@/components/ui/WalletButton";

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  "/": { title: "Dashboard", subtitle: "Overview" },
  "/identity": { title: "Identity", subtitle: "Sovereign ID" },
  "/credentials": { title: "Credentials", subtitle: "Verifiable" },
  "/verification": { title: "Verification", subtitle: "ZK Proofs" },
  "/governance": { title: "Governance", subtitle: "Proposals" },
  "/audit": { title: "Audit", subtitle: "Activity Log" },
  "/settings": { title: "Settings", subtitle: "Configure" },
  "/ai-compliance": { title: "AI Compliance", subtitle: "Intelligence" },
  "/agent-identity": { title: "Agent Identity", subtitle: "AI Agents" },
  "/analytics": { title: "Analytics", subtitle: "Insights" },
  "/regulatory": { title: "Regulatory", subtitle: "Compliance" },
  "/enterprise": { title: "Enterprise", subtitle: "Console" },
  "/cross-chain": { title: "Cross-Chain", subtitle: "Bridge" },
  "/marketplace": { title: "Marketplace", subtitle: "Discover" },
  "/integrations": { title: "Integrations", subtitle: "Connect" },
  "/revocation": { title: "Revocation", subtitle: "Manage" },
  "/admin": { title: "Admin", subtitle: "System" },
};

interface HeaderProps {
  onMenuClick: () => void;
  onSearchClick: () => void;
  sidebarCollapsed: boolean;
}

export function Header({ onMenuClick, onSearchClick }: HeaderProps) {
  const pathname = usePathname();

  const pageInfo = PAGE_TITLES[pathname] || { title: "ZeroID", subtitle: "" };

  return (
    <header
      className="sticky top-0 z-30 backdrop-blur-2xl"
      style={{
        background: "rgba(8, 9, 11, 0.72)",
        borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
      }}
    >
      <div className="flex items-center justify-between h-[64px] px-6 sm:px-8">
        {/* Left — Mobile menu + Page info */}
        <div className="flex items-center gap-4">
          <button
            onClick={onMenuClick}
            className="p-2 rounded-xl text-zero-500 hover:text-zero-300 transition-colors lg:hidden"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div>
            <h1 className="text-heading-md font-display tracking-tight text-white leading-none">
              {pageInfo.title}
            </h1>
            {pageInfo.subtitle && (
              <p className="text-[11px] text-zero-500 font-body mt-0.5 tracking-wide uppercase">
                {pageInfo.subtitle}
              </p>
            )}
          </div>
        </div>

        {/* Right — Actions */}
        <div className="flex items-center gap-2">
          {/* Search trigger */}
          <button
            onClick={onSearchClick}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-zero-500 hover:text-zero-300 transition-all text-[13px] font-body"
            style={{
              background: "rgba(255, 255, 255, 0.03)",
              border: "1px solid rgba(255, 255, 255, 0.05)",
            }}
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-zero-600">Search</span>
            <kbd
              className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] text-zero-600 rounded-md font-mono ml-2"
              style={{ background: "rgba(255, 255, 255, 0.04)" }}
            >
              <Command className="w-2.5 h-2.5" />K
            </kbd>
          </button>

          {/* Wallet */}
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
