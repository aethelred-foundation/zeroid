'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Bell,
  Menu,
  Command,
  X,
  AlertTriangle,
  Info,
  CheckCircle,
} from 'lucide-react';

import { WalletButton } from '@/components/ui/WalletButton';

interface Notification {
  id: string;
  type: 'success' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

const MOCK_NOTIFICATIONS: Notification[] = [
  { id: '1', type: 'success', title: 'Credential Verified', message: 'Your KYC credential has been verified on-chain.', timestamp: '2 min ago', read: false },
  { id: '2', type: 'warning', title: 'Credential Expiring', message: 'Your driver license credential expires in 7 days.', timestamp: '1 hr ago', read: false },
  { id: '3', type: 'info', title: 'Governance Proposal', message: 'New proposal #42 requires your vote.', timestamp: '3 hr ago', read: true },
];

const NOTIFICATION_ICONS: Record<string, React.ReactNode> = {
  success: <CheckCircle className="w-4 h-4 text-emerald-400" />,
  warning: <AlertTriangle className="w-4 h-4 text-amber-400" />,
  info: <Info className="w-4 h-4 text-chrome-300" />,
};

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  '/': { title: 'Dashboard', subtitle: 'Overview' },
  '/identity': { title: 'Identity', subtitle: 'Sovereign ID' },
  '/credentials': { title: 'Credentials', subtitle: 'Verifiable' },
  '/verification': { title: 'Verification', subtitle: 'ZK Proofs' },
  '/governance': { title: 'Governance', subtitle: 'Proposals' },
  '/audit': { title: 'Audit', subtitle: 'Activity Log' },
  '/settings': { title: 'Settings', subtitle: 'Configure' },
  '/ai-compliance': { title: 'AI Compliance', subtitle: 'Intelligence' },
  '/agent-identity': { title: 'Agent Identity', subtitle: 'AI Agents' },
  '/analytics': { title: 'Analytics', subtitle: 'Insights' },
  '/regulatory': { title: 'Regulatory', subtitle: 'Compliance' },
  '/enterprise': { title: 'Enterprise', subtitle: 'Console' },
  '/cross-chain': { title: 'Cross-Chain', subtitle: 'Bridge' },
  '/marketplace': { title: 'Marketplace', subtitle: 'Discover' },
  '/integrations': { title: 'Integrations', subtitle: 'Connect' },
  '/revocation': { title: 'Revocation', subtitle: 'Manage' },
  '/admin': { title: 'Admin', subtitle: 'System' },
};

interface HeaderProps {
  onMenuClick: () => void;
  onSearchClick: () => void;
  sidebarCollapsed: boolean;
}

export function Header({ onMenuClick, onSearchClick }: HeaderProps) {
  const pathname = usePathname();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState(MOCK_NOTIFICATIONS);

  const pageInfo = PAGE_TITLES[pathname] || { title: 'ZeroID', subtitle: '' };
  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const dismissNotification = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <header className="sticky top-0 z-30">
      <div className="flex items-center justify-between h-[72px] px-6 sm:px-8">
        {/* Left — Mobile menu + Page info */}
        <div className="flex items-center gap-4">
          <button
            onClick={onMenuClick}
            className="p-2 rounded-xl text-zero-500 hover:text-zero-300 transition-colors lg:hidden"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
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
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
            }}
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-zero-600">Search</span>
            <kbd className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] text-zero-600 rounded-md font-mono ml-2"
              style={{ background: 'rgba(255, 255, 255, 0.04)' }}>
              <Command className="w-2.5 h-2.5" />K
            </kbd>
          </button>

          {/* Notifications */}
          <div className="relative">
            <button
              onClick={() => setNotificationsOpen(!notificationsOpen)}
              className="relative p-2.5 rounded-xl text-zero-500 hover:text-zero-300 transition-colors"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
              aria-label="Notifications"
            >
              <Bell className="w-[16px] h-[16px]" />
              {unreadCount > 0 && (
                <span
                  className="absolute top-2 right-2 w-[6px] h-[6px] rounded-full bg-chrome-300"
                  style={{ boxShadow: '0 0 8px rgba(192, 196, 204, 0.5)' }}
                />
              )}
            </button>

            <AnimatePresence>
              {notificationsOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setNotificationsOpen(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.96 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute right-0 top-full mt-3 w-[360px] rounded-2xl overflow-hidden z-50"
                    style={{
                      background: 'rgba(14, 15, 18, 0.97)',
                      backdropFilter: 'blur(24px)',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
                    }}
                  >
                    <div className="flex items-center justify-between px-5 py-4"
                      style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <h3 className="text-[14px] font-semibold text-white font-display">Notifications</h3>
                      {unreadCount > 0 && (
                        <button onClick={markAllRead} className="text-[11px] text-chrome-400 hover:text-chrome-200 transition-colors font-body">
                          Mark all read
                        </button>
                      )}
                    </div>

                    <div className="max-h-80 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <p className="text-center text-[13px] text-zero-500 py-10 font-body">No notifications</p>
                      ) : (
                        notifications.map((n) => (
                          <div
                            key={n.id}
                            className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.02]"
                            style={{
                              borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
                              background: !n.read ? 'rgba(192, 196, 204, 0.02)' : 'transparent',
                            }}
                          >
                            <div className="mt-0.5 shrink-0 w-8 h-8 rounded-xl flex items-center justify-center"
                              style={{ background: 'rgba(255,255,255,0.04)' }}>
                              {NOTIFICATION_ICONS[n.type]}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-medium text-zero-200 font-body">{n.title}</p>
                              <p className="text-[11px] text-zero-500 mt-0.5 font-body leading-relaxed">{n.message}</p>
                              <p className="text-[10px] text-zero-600 mt-1.5 font-mono">{n.timestamp}</p>
                            </div>
                            <button
                              onClick={() => dismissNotification(n.id)}
                              className="p-1 rounded-lg text-zero-600 hover:text-zero-400 transition-colors shrink-0"
                              aria-label="Dismiss"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          {/* Wallet */}
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
