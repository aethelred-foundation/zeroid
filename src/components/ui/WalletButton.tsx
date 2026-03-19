"use client";

import React from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Wallet, ChevronDown, BadgeCheck, AlertCircle } from "lucide-react";

type VerificationLevel = "verified" | "pending" | "unverified";

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

export function WalletButton({ className = "" }: WalletButtonProps) {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        authenticationStatus,
        mounted,
      }) => {
        const ready = mounted && authenticationStatus !== "loading";
        const connected =
          ready &&
          account &&
          chain &&
          (!authenticationStatus || authenticationStatus === "authenticated");

        if (!ready) {
          return (
            <div
              className={`h-9 w-[130px] rounded-xl animate-pulse ${className}`}
              style={{ background: "rgba(255,255,255,0.04)" }}
            />
          );
        }

        if (!connected) {
          return (
            <button
              onClick={openConnectModal}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold transition-all font-display ${className}`}
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
          );
        }

        const verificationLevel: VerificationLevel = chain.unsupported
          ? "unverified"
          : "verified";

        return (
          <div className={`flex items-center gap-1.5 ${className}`}>
            {chain.unsupported ? (
              <button
                onClick={openChainModal}
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
                onClick={openChainModal}
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-[10px] text-zero-400 text-[11px] font-medium transition-colors hover:text-zero-200 font-body"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                {chain.hasIcon && chain.iconUrl && (
                  <img
                    src={chain.iconUrl}
                    alt={chain.name ?? "Chain"}
                    className="w-3.5 h-3.5 rounded-full"
                  />
                )}
                {chain.name}
              </button>
            )}

            <button
              onClick={openAccountModal}
              className="flex items-center gap-2 px-3 py-1.5 rounded-[10px] transition-all text-[13px] font-body"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <span className="text-zero-200 font-medium font-mono text-[11px]">
                {account.displayName}
              </span>
              <VerificationBadge level={verificationLevel} />
              {account.displayBalance && (
                <span className="hidden md:inline text-[11px] text-zero-500 font-mono">
                  {account.displayBalance}
                </span>
              )}
              <ChevronDown className="w-3 h-3 text-zero-500" />
            </button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
