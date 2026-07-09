"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import Image from "next/image";
import { ExternalLink, LogOut } from "lucide-react";
import { useAccount, useDisconnect } from "wagmi";

import type { NavItem } from "./AppLayout";
import { NAV_SECTIONS } from "./AppLayout";
import {
  getFeatureReadiness,
  readinessBadgeClass,
} from "@/lib/product/readiness";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  navItems: NavItem[];
  className?: string;
  mobile?: boolean;
}

/**
 * Labeled navigation panel, shared by the fixed desktop sidebar and the mobile
 * drawer. Grouped sections, glyph chips, and a spring-tracked active pill —
 * every destination is named, never a bare icon.
 */
export function Sidebar({
  collapsed: _collapsed,
  onToggle: _onToggle,
  navItems: _navItems,
  className = "",
  mobile = false,
}: SidebarProps) {
  const pathname = usePathname();
  const { isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  const body = (
    <>
      {/* Wordmark */}
      <div
        className="flex items-center gap-3 px-5 h-[64px] shrink-0"
        style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.05)" }}
      >
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/zeroid-logo.png"
            alt="ZeroID"
            width={28}
            height={28}
            className="object-contain rounded-lg"
            priority
          />
          <span className="text-[15px] font-semibold tracking-tight text-white font-display">
            Zero<span className="text-chrome-300">ID</span>
          </span>
        </Link>
      </div>

      {/* Sections */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_SECTIONS.map((section, si) => (
          <div key={section.title} className={si > 0 ? "mt-6" : ""}>
            <p className="px-2.5 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zero-600 font-body">
              {section.title}
            </p>
            <div className="space-y-px">
              {section.items.map((item) => {
                const active = isActive(item.href);
                const readiness = getFeatureReadiness(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-label={item.label}
                    className={`nav-row ${active ? "nav-row-active" : ""}`}
                  >
                    {active && (
                      <motion.span
                        layoutId={mobile ? "nav-pill-mobile" : "nav-pill"}
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-[2.5px] h-4 rounded-full"
                        style={{
                          background:
                            "linear-gradient(180deg, #d4d7de, #7c8290)",
                        }}
                        transition={{
                          type: "spring",
                          damping: 32,
                          stiffness: 420,
                        }}
                      />
                    )}
                    <span className="nav-glyph">{item.icon}</span>
                    <span className="truncate">{item.label}</span>
                    {/* One badge per row. Honest gating (Preview etc.) always
                        wins the slot; the decorative AI/New chips only show
                        when readiness is quiet, and ready states (Live /
                        Configured) carry no badge at all — a badge on every
                        row is noise, not information. */}
                    {readiness.status !== "Live" &&
                    readiness.status !== "Configured" ? (
                      <span
                        className={`ml-auto text-[9px] px-1.5 py-px rounded-full font-semibold tracking-wide uppercase ${readinessBadgeClass(
                          readiness.status,
                        )}`}
                      >
                        {readiness.status}
                      </span>
                    ) : (
                      item.badge && (
                        <span
                          className={`ml-auto text-[9px] px-1.5 py-px rounded-full font-semibold tracking-wide uppercase ${
                            item.badge === "AI"
                              ? "text-chrome-300 bg-chrome-300/8 border border-chrome-300/12"
                              : "text-emerald-400 bg-emerald-400/8 border border-emerald-400/12"
                          }`}
                        >
                          {item.badge}
                        </span>
                      )
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div
        className="shrink-0 px-3 py-3 space-y-px"
        style={{ borderTop: "1px solid rgba(255, 255, 255, 0.05)" }}
      >
        <a
          href="https://docs.aethelred.io/zeroid"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Documentation"
          className="nav-row"
        >
          <span className="nav-glyph">
            <ExternalLink className="w-4 h-4" />
          </span>
          Documentation
        </a>
        {isConnected && (
          <button
            onClick={() => disconnect()}
            aria-label="Disconnect"
            className="nav-row w-full text-left hover:!text-rose-400"
          >
            <span className="nav-glyph">
              <LogOut className="w-4 h-4" />
            </span>
            Disconnect
          </button>
        )}
        <div className="px-2.5 pt-2 text-[10px] text-zero-600 font-mono">
          v1.0.0
        </div>
      </div>
    </>
  );

  if (mobile) {
    return (
      <aside
        className={`w-[280px] flex flex-col h-screen sidebar-panel ${className}`}
      >
        {body}
      </aside>
    );
  }

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 w-[248px] flex-col sidebar-panel ${
        className.includes("lg:block") ? "hidden lg:flex" : "flex"
      } ${className.replace("lg:block", "").trim()}`}
    >
      {body}
    </aside>
  );
}
