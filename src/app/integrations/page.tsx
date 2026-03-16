'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Puzzle,
  Search,
  ExternalLink,
  Check,
  Plus,
  Shield,
  Globe,
  Wallet,
  Building2,
  Code,
  ArrowRight,
  Star,
  Zap,
  Lock,
} from 'lucide-react';
import AppLayout from '@/components/layout/AppLayout';

interface Integration {
  id: string;
  name: string;
  description: string;
  category: 'defi' | 'dao' | 'nft' | 'enterprise' | 'government';
  connected: boolean;
  verificationsCount: number;
  icon: string;
  requiredCredentials: string[];
}

const integrations: Integration[] = [
  {
    id: 'cruzible',
    name: 'Cruzible',
    description: 'Liquid staking vaults with KYC-gated access',
    category: 'defi',
    connected: true,
    verificationsCount: 45,
    icon: '🔥',
    requiredCredentials: ['Age Verification', 'KYC'],
  },
  {
    id: 'noblepay',
    name: 'NoblePay',
    description: 'Cross-border payments requiring identity verification',
    category: 'enterprise',
    connected: true,
    verificationsCount: 128,
    icon: '💰',
    requiredCredentials: ['KYC', 'Residency', 'Credit Tier'],
  },
  {
    id: 'shiora',
    name: 'Shiora',
    description: 'Health records with privacy-preserving identity',
    category: 'enterprise',
    connected: false,
    verificationsCount: 0,
    icon: '🏥',
    requiredCredentials: ['Age Verification', 'Nationality'],
  },
  {
    id: 'aethelred-dao',
    name: 'Aethelred DAO',
    description: 'Governance participation with verified identity',
    category: 'dao',
    connected: true,
    verificationsCount: 23,
    icon: '🏛️',
    requiredCredentials: ['KYC', 'Accredited Investor'],
  },
  {
    id: 'uae-pass',
    name: 'UAE Pass',
    description: 'Government identity verification via UAE Pass API',
    category: 'government',
    connected: true,
    verificationsCount: 312,
    icon: '🇦🇪',
    requiredCredentials: [],
  },
  {
    id: 'emirates-id',
    name: 'Emirates ID',
    description: 'National ID document verification',
    category: 'government',
    connected: true,
    verificationsCount: 198,
    icon: '🪪',
    requiredCredentials: [],
  },
  {
    id: 'aave-v3',
    name: 'Aave V3',
    description: 'Undercollateralized lending with verified credit score',
    category: 'defi',
    connected: false,
    verificationsCount: 0,
    icon: '👻',
    requiredCredentials: ['Credit Tier', 'KYC'],
  },
  {
    id: 'nft-marketplace',
    name: 'Aethelred NFT',
    description: 'Age-gated NFT marketplace access',
    category: 'nft',
    connected: false,
    verificationsCount: 0,
    icon: '🎨',
    requiredCredentials: ['Age Verification'],
  },
];

export default function IntegrationsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const filtered = integrations.filter((int) => {
    if (categoryFilter !== 'all' && int.category !== categoryFilter) return false;
    if (searchQuery && !int.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const connectedCount = integrations.filter((i) => i.connected).length;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Integrations</h1>
            <p className="text-[var(--text-secondary)] mt-1">
              {connectedCount} connected dApps using your ZeroID credentials
            </p>
          </div>
          <button className="btn-secondary">
            <Code className="w-4 h-4" />
            Developer Docs
          </button>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Connected dApps', value: connectedCount, icon: Puzzle },
            {
              label: 'Total Verifications',
              value: integrations.reduce((s, i) => s + i.verificationsCount, 0),
              icon: Shield,
            },
            { label: 'Available Integrations', value: integrations.length, icon: Globe },
          ].map((stat) => (
            <div key={stat.label} className="card p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-brand-600/10 flex items-center justify-center text-brand-500">
                <stat.icon className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xl font-bold">{stat.value}</div>
                <div className="text-xs text-[var(--text-tertiary)]">{stat.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Filter + Search */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
            <input
              type="text"
              placeholder="Search integrations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-10"
            />
          </div>
          <div className="flex items-center gap-1">
            {['all', 'defi', 'enterprise', 'government', 'dao', 'nft'].map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                  categoryFilter === cat
                    ? 'bg-brand-600 text-white'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Integrations Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((integration, i) => (
            <motion.div
              key={integration.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="card-hover p-5"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="text-3xl">{integration.icon}</div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{integration.name}</h3>
                      {integration.connected && (
                        <span className="badge-verified">
                          <Check className="w-3 h-3" />
                          Connected
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-[var(--text-secondary)] mt-1">
                      {integration.description}
                    </p>
                    {integration.requiredCredentials.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {integration.requiredCredentials.map((cred) => (
                          <span
                            key={cred}
                            className="text-2xs px-2 py-0.5 rounded-full bg-[var(--surface-secondary)] text-[var(--text-tertiary)]"
                          >
                            {cred}
                          </span>
                        ))}
                      </div>
                    )}
                    {integration.connected && integration.verificationsCount > 0 && (
                      <div className="text-xs text-[var(--text-tertiary)] mt-2">
                        {integration.verificationsCount} verifications
                      </div>
                    )}
                  </div>
                </div>
                <button
                  className={
                    integration.connected ? 'btn-ghost btn-sm' : 'btn-primary btn-sm'
                  }
                >
                  {integration.connected ? (
                    <>
                      Manage <ArrowRight className="w-3 h-3" />
                    </>
                  ) : (
                    <>
                      <Plus className="w-3 h-3" />
                      Connect
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Developer CTA */}
        <div className="card p-8 text-center bg-gradient-to-r from-brand-600/5 to-identity-chrome/5 border-brand-500/20">
          <Code className="w-10 h-10 mx-auto mb-3 text-brand-500" />
          <h3 className="text-lg font-semibold mb-2">Build with ZeroID</h3>
          <p className="text-sm text-[var(--text-secondary)] max-w-md mx-auto mb-4">
            Integrate zero-knowledge identity verification into your dApp with our SDK.
            One line of code to verify credentials.
          </p>
          <div className="flex justify-center gap-3">
            <button className="btn-primary">
              <Code className="w-4 h-4" />
              View SDK Docs
            </button>
            <button className="btn-secondary">
              <Globe className="w-4 h-4" />
              API Reference
            </button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
