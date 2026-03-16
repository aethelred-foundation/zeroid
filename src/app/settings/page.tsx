'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Settings,
  Shield,
  Bell,
  Key,
  Globe,
  Lock,
  Eye,
  Server,
  Database,
  Download,
  Trash2,
  AlertTriangle,
  Check,
  ChevronRight,
  Monitor,
  Moon,
  Sun,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import AppLayout from '@/components/layout/AppLayout';
import { useIdentity } from '@/hooks/useIdentity';

type SettingsTab = 'general' | 'privacy' | 'notifications' | 'security' | 'advanced';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const { theme, setTheme } = useTheme();
  const { identity } = useIdentity();

  const tabs = [
    { id: 'general' as const, label: 'General', icon: Settings },
    { id: 'privacy' as const, label: 'Privacy', icon: Eye },
    { id: 'notifications' as const, label: 'Notifications', icon: Bell },
    { id: 'security' as const, label: 'Security', icon: Lock },
    { id: 'advanced' as const, label: 'Advanced', icon: Server },
  ];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-[var(--text-secondary)] mt-1">
            Configure your ZeroID preferences
          </p>
        </div>

        <div className="grid grid-cols-12 gap-6">
          {/* Sidebar Tabs */}
          <div className="col-span-12 lg:col-span-3">
            <nav className="space-y-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                    activeTab === tab.id
                      ? 'bg-brand-600 text-white'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]'
                  }`}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Settings Content */}
          <div className="col-span-12 lg:col-span-9">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="card"
            >
              {activeTab === 'general' && (
                <div className="divide-y divide-[var(--border-secondary)]">
                  <div className="p-6">
                    <h2 className="text-lg font-semibold mb-1">General</h2>
                    <p className="text-sm text-[var(--text-secondary)]">
                      Manage your account preferences
                    </p>
                  </div>

                  {/* Theme */}
                  <div className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">Theme</div>
                        <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                          Choose your preferred appearance
                        </div>
                      </div>
                      <div className="flex items-center gap-1 p-1 bg-[var(--surface-secondary)] rounded-xl">
                        {[
                          { id: 'light', icon: Sun },
                          { id: 'dark', icon: Moon },
                          { id: 'system', icon: Monitor },
                        ].map((t) => (
                          <button
                            key={t.id}
                            onClick={() => setTheme(t.id)}
                            className={`p-2 rounded-lg transition-colors ${
                              theme === t.id
                                ? 'bg-[var(--surface-elevated)] shadow-sm text-[var(--text-primary)]'
                                : 'text-[var(--text-tertiary)]'
                            }`}
                          >
                            <t.icon className="w-4 h-4" />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Network */}
                  <div className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">Network</div>
                        <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                          Select the blockchain network
                        </div>
                      </div>
                      <select className="input w-48">
                        <option>Aethelred Mainnet</option>
                        <option>Aethelred Testnet</option>
                        <option>Local Development</option>
                      </select>
                    </div>
                  </div>

                  {/* Language */}
                  <div className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">Language</div>
                        <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                          Interface language
                        </div>
                      </div>
                      <select className="input w-48">
                        <option>English</option>
                        <option>Arabic</option>
                        <option>French</option>
                        <option>Hindi</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'privacy' && (
                <div className="divide-y divide-[var(--border-secondary)]">
                  <div className="p-6">
                    <h2 className="text-lg font-semibold mb-1">Privacy</h2>
                    <p className="text-sm text-[var(--text-secondary)]">
                      Control what data is shared and how
                    </p>
                  </div>

                  {[
                    {
                      title: 'Default Disclosure Mode',
                      desc: 'Always use ZK proofs for attribute verification',
                      enabled: true,
                    },
                    {
                      title: 'Auto-reject Unrecognized Verifiers',
                      desc: 'Reject verification requests from unknown dApps',
                      enabled: false,
                    },
                    {
                      title: 'Credential Visibility',
                      desc: 'Hide credential count from public profile',
                      enabled: true,
                    },
                    {
                      title: 'Audit Log Privacy',
                      desc: 'Encrypt audit log entries at rest',
                      enabled: true,
                    },
                    {
                      title: 'TEE-only Verification',
                      desc: 'Only accept verification through TEE enclaves',
                      enabled: true,
                    },
                  ].map((setting) => (
                    <div key={setting.title} className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-sm">{setting.title}</div>
                          <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                            {setting.desc}
                          </div>
                        </div>
                        <button
                          className={`relative w-11 h-6 rounded-full transition-colors ${
                            setting.enabled ? 'bg-brand-600' : 'bg-[var(--surface-tertiary)]'
                          }`}
                        >
                          <div
                            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                              setting.enabled ? 'translate-x-5.5 left-0.5' : 'left-0.5'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'notifications' && (
                <div className="divide-y divide-[var(--border-secondary)]">
                  <div className="p-6">
                    <h2 className="text-lg font-semibold mb-1">Notifications</h2>
                    <p className="text-sm text-[var(--text-secondary)]">
                      Choose what you want to be notified about
                    </p>
                  </div>

                  {[
                    { title: 'Verification Requests', desc: 'When a dApp requests verification', enabled: true },
                    { title: 'Credential Expiry', desc: '30 days before a credential expires', enabled: true },
                    { title: 'Governance Proposals', desc: 'New proposals and voting deadlines', enabled: true },
                    { title: 'TEE Node Alerts', desc: 'When your preferred TEE node is unhealthy', enabled: false },
                    { title: 'Credential Revocation', desc: 'If any credential is revoked', enabled: true },
                  ].map((notif) => (
                    <div key={notif.title} className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-sm">{notif.title}</div>
                          <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                            {notif.desc}
                          </div>
                        </div>
                        <button
                          className={`relative w-11 h-6 rounded-full transition-colors ${
                            notif.enabled ? 'bg-brand-600' : 'bg-[var(--surface-tertiary)]'
                          }`}
                        >
                          <div
                            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                              notif.enabled ? 'translate-x-5.5 left-0.5' : 'left-0.5'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'security' && (
                <div className="divide-y divide-[var(--border-secondary)]">
                  <div className="p-6">
                    <h2 className="text-lg font-semibold mb-1">Security</h2>
                    <p className="text-sm text-[var(--text-secondary)]">
                      Manage security settings for your identity
                    </p>
                  </div>

                  <div className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">Recovery Guardians</div>
                        <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                          3 of 5 guardians configured
                        </div>
                      </div>
                      <button className="btn-secondary btn-sm">
                        Manage <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">Session Management</div>
                        <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                          2 active sessions
                        </div>
                      </div>
                      <button className="btn-secondary btn-sm">
                        View Sessions <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">Hardware Key</div>
                        <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                          Bind a hardware security key for signing
                        </div>
                      </div>
                      <button className="btn-secondary btn-sm">
                        Configure <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'advanced' && (
                <div className="divide-y divide-[var(--border-secondary)]">
                  <div className="p-6">
                    <h2 className="text-lg font-semibold mb-1">Advanced</h2>
                    <p className="text-sm text-[var(--text-secondary)]">
                      Advanced settings and data management
                    </p>
                  </div>

                  <div className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">Export Identity Data</div>
                        <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                          Download all your identity data as encrypted JSON
                        </div>
                      </div>
                      <button className="btn-secondary btn-sm">
                        <Download className="w-4 h-4" />
                        Export
                      </button>
                    </div>
                  </div>

                  <div className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">Preferred TEE Provider</div>
                        <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                          Select your preferred TEE enclave type
                        </div>
                      </div>
                      <select className="input w-48">
                        <option>Intel SGX (Default)</option>
                        <option>AMD SEV-SNP</option>
                        <option>ARM TrustZone</option>
                        <option>Any Available</option>
                      </select>
                    </div>
                  </div>

                  <div className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">ZK Proving Backend</div>
                        <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                          Choose proof generation method
                        </div>
                      </div>
                      <select className="input w-48">
                        <option>Browser (WASM)</option>
                        <option>Server-side</option>
                        <option>TEE Enclave</option>
                      </select>
                    </div>
                  </div>

                  <div className="p-6">
                    <div className="p-4 bg-status-revoked/5 border border-status-revoked/20 rounded-xl">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-status-revoked shrink-0 mt-0.5" />
                        <div>
                          <div className="font-medium text-sm text-status-revoked">
                            Danger Zone
                          </div>
                          <div className="text-xs text-[var(--text-secondary)] mt-1 mb-3">
                            Permanently delete your identity and all associated credentials.
                            This action is irreversible.
                          </div>
                          <button className="btn-danger btn-sm">
                            <Trash2 className="w-4 h-4" />
                            Delete Identity
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
