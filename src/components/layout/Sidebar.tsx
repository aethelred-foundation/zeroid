'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import {
  ExternalLink,
  LogOut,
  Settings,
} from 'lucide-react';
import { useAccount, useDisconnect } from 'wagmi';

import type { NavItem } from './AppLayout';
import { NAV_SECTIONS } from './AppLayout';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  navItems: NavItem[];
  className?: string;
  mobile?: boolean;
}

export function Sidebar({
  collapsed: _collapsed,
  onToggle: _onToggle,
  navItems: _navItems,
  className = '',
  mobile = false,
}: SidebarProps) {
  const pathname = usePathname();
  const { isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  // Flatten all nav items for the dock
  const allItems = NAV_SECTIONS.flatMap((s) => s.items);

  // Mobile gets a full sidebar, desktop gets a dock
  if (mobile) {
    return (
      <aside
        className={`w-[280px] flex flex-col h-screen ${className}`}
        style={{
          background: 'var(--surface-secondary)',
          borderRight: '1px solid rgba(255, 255, 255, 0.04)',
        }}
      >
        <div className="flex items-center gap-3 px-5 h-[64px] shrink-0" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
          <Image src="/zeroid-logo.png" alt="ZeroID" width={28} height={28} className="object-contain rounded-lg" priority />
          <span className="text-[15px] font-semibold tracking-tight text-white font-display">
            Zero<span className="text-chrome-300">ID</span>
          </span>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {NAV_SECTIONS.map((section, si) => (
            <div key={section.title} className={si > 0 ? 'mt-5' : ''}>
              <p className="px-3 mb-1.5 text-label-sm uppercase text-zero-500 font-body">
                {section.title}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 font-body ${
                        active ? 'text-white' : 'text-zero-400 hover:text-zero-200'
                      }`}
                      style={active ? { background: 'rgba(192, 196, 204, 0.08)' } : {}}
                    >
                      <span className={active ? 'text-chrome-300' : 'text-zero-500 group-hover:text-zero-400'}>
                        {item.icon}
                      </span>
                      <span className="truncate">{item.label}</span>
                      {item.badge && (
                        <span className={`ml-auto text-[9px] px-1.5 py-px rounded-full font-semibold tracking-wide uppercase ${
                          item.badge === 'AI' ? 'text-chrome-300 bg-chrome-300/8 border border-chrome-300/12'
                          : 'text-emerald-400 bg-emerald-400/8 border border-emerald-400/12'
                        }`}>
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="shrink-0 px-3 pb-4 space-y-1" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.04)' }}>
          <div className="pt-3" />
          {isConnected && (
            <button onClick={() => disconnect()} className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-zero-500 hover:text-rose-400 transition-colors text-[12px] w-full font-body">
              <LogOut className="w-3.5 h-3.5" /> Disconnect
            </button>
          )}
          <div className="px-3 pt-2 text-[10px] text-zero-600 font-mono">v1.0.0</div>
        </div>
      </aside>
    );
  }

  // Desktop: Floating glass dock
  return (
    <aside className={`fixed left-4 top-1/2 -translate-y-1/2 z-40 ${className}`}>
      <div className="dock rounded-2xl p-2 flex flex-col items-center gap-1">
        {/* Logo */}
        <Link href="/" className="mb-2 p-1">
          <Image
            src="/zeroid-logo.png"
            alt="ZeroID"
            width={28}
            height={28}
            className="object-contain rounded-lg"
            priority
          />
        </Link>

        {/* Separator */}
        <div className="w-6 h-px mb-1" style={{ background: 'rgba(255, 255, 255, 0.06)' }} />

        {/* Nav items */}
        {allItems.map((item) => {
          const active = isActive(item.href);
          const isHovered = hoveredItem === item.href;

          return (
            <div key={item.href} className="relative">
              <Link
                href={item.href}
                className={`dock-item ${active ? 'dock-item-active' : ''}`}
                onMouseEnter={() => setHoveredItem(item.href)}
                onMouseLeave={() => setHoveredItem(null)}
                aria-label={item.label}
              >
                {/* Active indicator bar */}
                {active && (
                  <motion.div
                    layoutId="dock-active"
                    className="absolute -left-[5px] top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full"
                    style={{ background: 'linear-gradient(180deg, #c0c4cc, #7c8290)' }}
                    transition={{ type: 'spring', damping: 30, stiffness: 400 }}
                  />
                )}
                {item.icon}
                {/* Badge dot */}
                {item.badge && (
                  <span className="absolute top-1 right-1 w-[5px] h-[5px] rounded-full bg-chrome-300" />
                )}
              </Link>

              {/* Tooltip */}
              <AnimatePresence>
                {isHovered && (
                  <motion.div
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -4 }}
                    transition={{ duration: 0.15 }}
                    className="tooltip"
                    style={{ top: '50%', transform: 'translateY(-50%)' }}
                  >
                    {item.label}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {/* Separator */}
        <div className="w-6 h-px my-1" style={{ background: 'rgba(255, 255, 255, 0.06)' }} />

        {/* Bottom actions */}
        <div className="relative">
          <a
            href="https://docs.aethelred.io/zeroid"
            target="_blank"
            rel="noopener noreferrer"
            className="dock-item"
            onMouseEnter={() => setHoveredItem('docs')}
            onMouseLeave={() => setHoveredItem(null)}
            aria-label="Documentation"
          >
            <ExternalLink className="w-[16px] h-[16px]" />
          </a>
          <AnimatePresence>
            {hoveredItem === 'docs' && (
              <motion.div
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -4 }}
                transition={{ duration: 0.15 }}
                className="tooltip"
                style={{ top: '50%', transform: 'translateY(-50%)' }}
              >
                Documentation
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {isConnected && (
          <div className="relative">
            <button
              onClick={() => disconnect()}
              className="dock-item text-zero-600 hover:text-rose-400"
              onMouseEnter={() => setHoveredItem('disconnect')}
              onMouseLeave={() => setHoveredItem(null)}
              aria-label="Disconnect"
            >
              <LogOut className="w-[16px] h-[16px]" />
            </button>
            <AnimatePresence>
              {hoveredItem === 'disconnect' && (
                <motion.div
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -4 }}
                  transition={{ duration: 0.15 }}
                  className="tooltip"
                  style={{ top: '50%', transform: 'translateY(-50%)' }}
                >
                  Disconnect
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </aside>
  );
}
