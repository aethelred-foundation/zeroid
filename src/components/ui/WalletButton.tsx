"use client";

import React, { useState } from "react";
import { formatUnits } from "viem";
import {
  useAccount,
  useBalance,
  useChainId,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { Wallet, ChevronDown, BadgeCheck, AlertCircle } from "lucide-react";
import {
  activeChain,
  aethelredDevnet,
  aethelredMainnet,
  aethelredTestnet,
} from "@/config/chains";

type VerificationLevel = "verified" | "pending" | "unverified";

const SUPPORTED_CHAINS = [aethelredMainnet, aethelredTestnet, aethelredDevnet];

function VerificationBadge({ level }: { level: VerificationLevel }) {
  const config: Record<
    VerificationLevel,
    { icon: React.ReactNode; className: string; label: string }
  > = {
    verified: {
      icon: <BadgeCheck className="w-3 h-3" />,
      className: "text-emerald-400 bg-emerald-400/8 border-emerald-400/15",
      label: "Verified",
    },
    pending: {
      icon: <AlertCircle className="w-3 h-3" />,
      className: "text-amber-400 bg-amber-400/8 border-amber-400/15",
      label: "Pending",
    },
    unverified: {
      icon: <AlertCircle className="w-3 h-3" />,
      className: "text-zero-400 bg-zero-400/8 border-zero-400/15",
      label: "Unverified",
    },
  };

  const { icon, className, label } = config[level];

  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium border ${className}`}
      title={label}
    >
      {icon}
    </span>
  );
}

interface WalletButtonProps {
  className?: string;
}

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function WalletButton({ className = "" }: WalletButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { address, isConnected, isConnecting } = useAccount();
  const chainId = useChainId();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { data: balance } = useBalance({
    address,
    query: { enabled: Boolean(address) },
  });

  const chain = SUPPORTED_CHAINS.find((candidate) => candidate.id === chainId);
  const wrongNetwork = isConnected && !chain;
  const displayBalance = balance
    ? `${Number(formatUnits(balance.value, balance.decimals)).toLocaleString(
        undefined,
        {
          maximumFractionDigits: 4,
        },
      )} ${balance.symbol}`
    : undefined;

  if (isConnecting) {
    return (
      <div
        className={`h-9 w-[130px] rounded-xl animate-pulse ${className}`}
        style={{ background: "rgba(255,255,255,0.04)" }}
      />
    );
  }

  if (!isConnected || !address) {
    return (
      <div className={`relative inline-flex ${className}`}>
        <button
          onClick={() => setMenuOpen((open) => !open)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold transition-all font-display"
          style={{
            background: "linear-gradient(180deg, #c6c9d0 0%, #9ca0ab 100%)",
            color: "#0a0b0d",
            boxShadow:
              "0 1px 2px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.1) inset, 0 1px 0 rgba(255,255,255,0.15) inset",
          }}
        >
          <Wallet className="w-4 h-4" />
          Connect
        </button>

        {menuOpen && (
          <div
            className="absolute right-0 top-11 z-50 min-w-[190px] rounded-2xl p-1.5 shadow-2xl"
            style={{
              background: "rgba(12,13,16,0.98)",
              border: "1px solid rgba(255,255,255,0.08)",
              backdropFilter: "blur(18px)",
            }}
          >
            {connectors.map((connector) => (
              <button
                key={connector.uid}
                disabled={isPending}
                onClick={() => {
                  connect({ connector });
                  setMenuOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[12px] font-medium text-zero-200 transition-colors hover:bg-white/[0.06] disabled:opacity-60"
              >
                {connector.name}
                <span className="text-[10px] uppercase tracking-[0.18em] text-zero-500">
                  Wallet
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const verificationLevel: VerificationLevel = wrongNetwork
    ? "unverified"
    : "verified";

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      {wrongNetwork ? (
        <button
          onClick={() => switchChain({ chainId: activeChain.id })}
          className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors text-rose-400"
          style={{
            background: "rgba(251,113,133,0.08)",
            border: "1px solid rgba(251,113,133,0.15)",
          }}
        >
          Wrong Network
        </button>
      ) : (
        <button
          onClick={() => switchChain({ chainId: activeChain.id })}
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-[10px] text-zero-400 text-[11px] font-medium transition-colors hover:text-zero-200 font-body"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          {chain?.name ?? "Aethelred"}
        </button>
      )}

      <button
        onClick={() => disconnect()}
        className="flex items-center gap-2 px-3 py-1.5 rounded-[10px] transition-all text-[13px] font-body"
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
        title="Disconnect wallet"
      >
        <span className="text-zero-200 font-medium font-mono text-[11px]">
          {formatAddress(address)}
        </span>
        <VerificationBadge level={verificationLevel} />
        {displayBalance && (
          <span className="hidden md:inline text-[11px] text-zero-500 font-mono">
            {displayBalance}
          </span>
        )}
        <ChevronDown className="w-3 h-3 text-zero-500" />
      </button>
    </div>
  );
}
