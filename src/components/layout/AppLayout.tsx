'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  X,
  LayoutDashboard,
  Fingerprint,
  BadgeCheck,
  ScanEye,
  Vote,
  ClipboardList,
  Settings,
  Command,
  Brain,
  Bot,
  Globe,
  Building2,
  Store,
  GitBranch,
  BarChart3,
  ShieldAlert,
  Puzzle,
  UserCog,
} from 'lucide-react';

import { Sidebar } from './Sidebar';
import { Header } from './Header';

// ============================================================
// Navigation Configuration
// ============================================================

export interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

const ICON_SIZE = 'w-[17px] h-[17px]';

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Core',
    items: [
      { label: 'Dashboard', href: '/', icon: <LayoutDashboard className={ICON_SIZE} /> },
      { label: 'Identity', href: '/identity', icon: <Fingerprint className={ICON_SIZE} /> },
      { label: 'Credentials', href: '/credentials', icon: <BadgeCheck className={ICON_SIZE} /> },
      { label: 'Verification', href: '/verification', icon: <ScanEye className={ICON_SIZE} /> },
    ],
  },
  {
    title: 'Intelligence',
    items: [
      { label: 'AI Compliance', href: '/ai-compliance', icon: <Brain className={ICON_SIZE} />, badge: 'AI' },
      { label: 'Agent Identity', href: '/agent-identity', icon: <Bot className={ICON_SIZE} />, badge: 'New' },
      { label: 'Analytics', href: '/analytics', icon: <BarChart3 className={ICON_SIZE} /> },
    ],
  },
  {
    title: 'Enterprise',
    items: [
      { label: 'Regulatory', href: '/regulatory', icon: <Globe className={ICON_SIZE} /> },
      { label: 'Enterprise', href: '/enterprise', icon: <Building2 className={ICON_SIZE} /> },
      { label: 'Cross-Chain', href: '/cross-chain', icon: <GitBranch className={ICON_SIZE} /> },
      { label: 'Marketplace', href: '/marketplace', icon: <Store className={ICON_SIZE} /> },
      { label: 'Integrations', href: '/integrations', icon: <Puzzle className={ICON_SIZE} /> },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Governance', href: '/governance', icon: <Vote className={ICON_SIZE} /> },
      { label: 'Audit', href: '/audit', icon: <ClipboardList className={ICON_SIZE} /> },
      { label: 'Revocation', href: '/revocation', icon: <ShieldAlert className={ICON_SIZE} /> },
      { label: 'Admin', href: '/admin', icon: <UserCog className={ICON_SIZE} /> },
      { label: 'Settings', href: '/settings', icon: <Settings className={ICON_SIZE} /> },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

// ============================================================
// Search Overlay — Full-screen command palette
// ============================================================

const SEARCH_ITEMS = [
  { label: 'Dashboard', href: '/', section: 'Core', icon: <LayoutDashboard className="w-4 h-4" /> },
  { label: 'Identity', href: '/identity', section: 'Core', icon: <Fingerprint className="w-4 h-4" /> },
  { label: 'Credentials', href: '/credentials', section: 'Core', icon: <BadgeCheck className="w-4 h-4" /> },
  { label: 'Verification', href: '/verification', section: 'Core', icon: <ScanEye className="w-4 h-4" /> },
  { label: 'AI Compliance', href: '/ai-compliance', section: 'Intelligence', icon: <Brain className="w-4 h-4" /> },
  { label: 'Agent Identity', href: '/agent-identity', section: 'Intelligence', icon: <Bot className="w-4 h-4" /> },
  { label: 'Analytics', href: '/analytics', section: 'Intelligence', icon: <BarChart3 className="w-4 h-4" /> },
  { label: 'Regulatory', href: '/regulatory', section: 'Enterprise', icon: <Globe className="w-4 h-4" /> },
  { label: 'Enterprise Console', href: '/enterprise', section: 'Enterprise', icon: <Building2 className="w-4 h-4" /> },
  { label: 'Cross-Chain Bridge', href: '/cross-chain', section: 'Enterprise', icon: <GitBranch className="w-4 h-4" /> },
  { label: 'Marketplace', href: '/marketplace', section: 'Enterprise', icon: <Store className="w-4 h-4" /> },
  { label: 'Integrations', href: '/integrations', section: 'Enterprise', icon: <Puzzle className="w-4 h-4" /> },
  { label: 'Governance', href: '/governance', section: 'System', icon: <Vote className="w-4 h-4" /> },
  { label: 'Audit Log', href: '/audit', section: 'System', icon: <ClipboardList className="w-4 h-4" /> },
  { label: 'Revocation', href: '/revocation', section: 'System', icon: <ShieldAlert className="w-4 h-4" /> },
  { label: 'Admin', href: '/admin', section: 'System', icon: <UserCog className="w-4 h-4" /> },
  { label: 'Settings', href: '/settings', section: 'System', icon: <Settings className="w-4 h-4" /> },
  { label: 'Create DID', href: '/identity', section: 'Actions', icon: <Fingerprint className="w-4 h-4" /> },
  { label: 'Issue Credential', href: '/credentials', section: 'Actions', icon: <BadgeCheck className="w-4 h-4" /> },
  { label: 'Generate ZK Proof', href: '/verification', section: 'Actions', icon: <ScanEye className="w-4 h-4" /> },
  { label: 'Register AI Agent', href: '/agent-identity', section: 'Actions', icon: <Bot className="w-4 h-4" /> },
  { label: 'Submit Proposal', href: '/governance', section: 'Actions', icon: <Vote className="w-4 h-4" /> },
];

function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const filtered = query
    ? SEARCH_ITEMS.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
    : SEARCH_ITEMS;

  const sections = Array.from(new Set(filtered.map((i) => i.section)));

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh]" role="search">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-md"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -12 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-[560px] rounded-2xl overflow-hidden"
            style={{
              background: 'rgba(14, 15, 18, 0.97)',
              backdropFilter: 'blur(32px)',
              border: '1px solid rgba(255, 255, 255, 0.07)',
              boxShadow: '0 40px 100px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.03) inset',
            }}
          >
            <div className="flex items-center gap-3 px-5" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
              <Search className="w-[18px] h-[18px] text-chrome-400 shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search pages, actions..."
                className="w-full py-4 bg-transparent text-white placeholder:text-zero-500 focus:outline-none text-[15px] font-body"
              />
              <kbd className="hidden sm:flex items-center px-2 py-1 text-[10px] text-zero-600 rounded-lg font-mono"
                style={{ background: 'rgba(255, 255, 255, 0.04)' }}>
                ESC
              </kbd>
            </div>

            <div className="max-h-[380px] overflow-y-auto p-2">
              {filtered.length === 0 && (
                <p className="text-center text-[13px] text-zero-500 py-12 font-body">No results found</p>
              )}
              {sections.map((section) => (
                <div key={section}>
                  <p className="px-3 py-2.5 text-label-sm uppercase text-zero-500 font-body">
                    {section}
                  </p>
                  {filtered
                    .filter((i) => i.section === section)
                    .map((item) => (
                      <Link
                        key={`${item.section}-${item.label}`}
                        href={item.href}
                        onClick={onClose}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-zero-400 hover:text-white hover:bg-white/[0.04] transition-all text-[13px] font-body group"
                      >
                        <span className="w-8 h-8 rounded-lg flex items-center justify-center text-zero-500 group-hover:text-chrome-300 transition-colors"
                          style={{ background: 'rgba(255,255,255,0.03)' }}>
                          {item.icon}
                        </span>
                        {item.label}
                      </Link>
                    ))}
                </div>
              ))}
            </div>

            <div className="px-5 py-3 flex items-center gap-5 text-[10px] text-zero-600 font-body"
              style={{ borderTop: '1px solid rgba(255, 255, 255, 0.04)' }}>
              <span className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 rounded text-[9px] font-mono" style={{ background: 'rgba(255, 255, 255, 0.04)' }}>Enter</kbd>
                select
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 rounded text-[9px] font-mono" style={{ background: 'rgba(255, 255, 255, 0.04)' }}>Esc</kbd>
                close
              </span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// ============================================================
// AppLayout — Floating dock + full-width content
// ============================================================

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const pathname = usePathname();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => { setMobileSidebarOpen(false); }, [pathname]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && searchOpen) setSearchOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [searchOpen]);

  useEffect(() => {
    document.body.style.overflow = mobileSidebarOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileSidebarOpen]);

  const openSearch = useCallback(() => setSearchOpen(true), []);

  return (
    <div className="min-h-screen relative" style={{ background: 'var(--surface-primary)', color: 'var(--text-primary)' }}>
      {/* Ambient chrome light */}
      <div className="ambient-chrome" />

      {/* Noise texture */}
      <div className="noise-overlay" />

      {/* Desktop floating dock */}
      <Sidebar collapsed={false} onToggle={() => {}} navItems={NAV_ITEMS} className="hidden lg:block" />

      {/* Mobile sidebar */}
      <AnimatePresence>
        {mobileSidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 lg:hidden"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <motion.div
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 28, stiffness: 350 }}
              className="fixed inset-y-0 left-0 z-50 lg:hidden"
            >
              <Sidebar collapsed={false} onToggle={() => setMobileSidebarOpen(false)} navItems={NAV_ITEMS} mobile />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main content area — offset for dock on desktop */}
      <div className="lg:pl-[76px] flex flex-col min-h-screen relative z-10">
        <Header
          onMenuClick={() => setMobileSidebarOpen(true)}
          onSearchClick={openSearch}
          sidebarCollapsed={false}
        />

        <main className="flex-1">
          <div className="mx-auto max-w-[1320px] px-5 sm:px-8 lg:px-10 pb-8">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            >
              {children}
            </motion.div>
          </div>
        </main>

        {/* Footer */}
        <footer className="py-5 px-6 sm:px-8 lg:px-10">
          <div className="separator mb-5" />
          <div className="mx-auto max-w-[1320px] flex items-center justify-between text-[11px] text-zero-600 font-body">
            <div className="flex items-center gap-3">
              <span className="font-display font-semibold text-zero-500 text-[12px]">ZeroID</span>
              <span className="w-px h-3 bg-zero-800" />
              <span>Aethelred Network</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="relative flex h-[5px] w-[5px]">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex rounded-full h-[5px] w-[5px] bg-emerald-500" />
                </span>
                <span className="text-emerald-500">Online</span>
              </span>
              <span className="w-px h-3 bg-zero-800" />
              <span className="font-mono text-zero-700">v1.0.0</span>
            </div>
          </div>
        </footer>
      </div>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

export default AppLayout;
