'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Store,
  Search,
  Filter,
  Star,
  ShieldCheck,
  CheckCircle2,
  Globe,
  ArrowRight,
  ChevronDown,
  Users,
  Award,
  TrendingUp,
  Coins,
  BookOpen,
  Building2,
  Fingerprint,
  FileText,
  Heart,
  ExternalLink,
  BadgeCheck,
  Clock,
  Tag,
  Grid3X3,
  List,
  SortAsc,
} from 'lucide-react';
import AppLayout from '@/components/layout/AppLayout';

// ============================================================
// Mock Data
// ============================================================

const credentialSchemas = [
  { id: 'cs1', name: 'KYC Identity Verification', category: 'Identity', issuer: 'Aethelred Trust Services', trustScore: 98, verifications: 128439, price: 'Free', staking: '100 AETH', jurisdictions: ['US', 'EU', 'UAE', 'SG'], featured: true, description: 'Full KYC verification including document check, biometric matching, and liveness detection via TEE.', useCases: ['DeFi onboarding', 'Exchange verification', 'Institutional access'] },
  { id: 'cs2', name: 'Accredited Investor Attestation', category: 'Financial', issuer: 'SecureVault Compliance', trustScore: 96, verifications: 45821, price: '$25', staking: '500 AETH', jurisdictions: ['US', 'EU', 'UK'], featured: true, description: 'SEC-compliant accredited investor verification with income and net worth attestation.', useCases: ['Security token offerings', 'Private fund access', 'Reg D compliance'] },
  { id: 'cs3', name: 'Age Verification (18+)', category: 'Identity', issuer: 'Aethelred Trust Services', trustScore: 98, verifications: 892341, price: 'Free', staking: '50 AETH', jurisdictions: ['Global'], featured: false, description: 'Zero-knowledge proof of age without revealing date of birth. Accepted globally.', useCases: ['Gaming platforms', 'Content access', 'E-commerce age gates'] },
  { id: 'cs4', name: 'Business Entity Verification', category: 'Corporate', issuer: 'Dubai Chamber Digital', trustScore: 94, verifications: 12847, price: '$50', staking: '1000 AETH', jurisdictions: ['UAE', 'SG', 'HK'], featured: true, description: 'Company registration and beneficial ownership verification for institutional entities.', useCases: ['B2B transactions', 'Supply chain', 'Institutional DeFi'] },
  { id: 'cs5', name: 'Anti-Money Laundering Certificate', category: 'Compliance', issuer: 'ComplianceFirst AG', trustScore: 92, verifications: 34521, price: '$15', staking: '250 AETH', jurisdictions: ['US', 'EU', 'UK', 'CH'], featured: false, description: 'AML compliance attestation including source of funds and transaction monitoring clearance.', useCases: ['Cross-border payments', 'High-value transfers', 'Institutional trading'] },
  { id: 'cs6', name: 'Professional License Credential', category: 'Professional', issuer: 'Credential Alliance', trustScore: 89, verifications: 8932, price: '$10', staking: '150 AETH', jurisdictions: ['US', 'EU', 'UK', 'AU'], featured: false, description: 'Verification of professional licenses (medical, legal, financial advisory) from issuing authorities.', useCases: ['Professional services', 'Regulatory compliance', 'Background checks'] },
  { id: 'cs7', name: 'Residency Proof', category: 'Identity', issuer: 'GovTech Solutions', trustScore: 91, verifications: 67234, price: 'Free', staking: '100 AETH', jurisdictions: ['UAE', 'SG', 'EU'], featured: false, description: 'Government-issued residency proof with address verification. Privacy-preserving jurisdiction attestation.', useCases: ['Tax compliance', 'Regulatory reporting', 'Voting eligibility'] },
  { id: 'cs8', name: 'Credit Score Attestation', category: 'Financial', issuer: 'FinScore Labs', trustScore: 87, verifications: 23456, price: '$20', staking: '200 AETH', jurisdictions: ['US', 'UK', 'EU'], featured: false, description: 'Credit tier attestation using ZK proofs. Prove creditworthiness without revealing exact score.', useCases: ['DeFi lending', 'Undercollateralized loans', 'Insurance underwriting'] },
];

const issuers = [
  { id: 'i1', name: 'Aethelred Trust Services', trustScore: 98, verifications: 1021780, specializations: ['Identity', 'Compliance'], joined: 'Sep 2025', badge: 'Founding Issuer' },
  { id: 'i2', name: 'SecureVault Compliance', trustScore: 96, verifications: 456821, specializations: ['Financial', 'Compliance'], joined: 'Oct 2025', badge: 'Top Issuer' },
  { id: 'i3', name: 'Dubai Chamber Digital', trustScore: 94, verifications: 128470, specializations: ['Corporate', 'Government'], joined: 'Nov 2025', badge: 'Government Partner' },
  { id: 'i4', name: 'ComplianceFirst AG', trustScore: 92, verifications: 234521, specializations: ['Compliance', 'AML'], joined: 'Dec 2025', badge: 'Verified' },
  { id: 'i5', name: 'Credential Alliance', trustScore: 89, verifications: 89320, specializations: ['Professional', 'Education'], joined: 'Jan 2026', badge: 'Verified' },
];

const categories = ['All', 'Identity', 'Financial', 'Compliance', 'Corporate', 'Professional'];

// ============================================================
// Component
// ============================================================

export default function MarketplacePage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedJurisdiction, setSelectedJurisdiction] = useState('All');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showIssuerDetail, setShowIssuerDetail] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'schemas' | 'issuers'>('schemas');

  const filteredSchemas = credentialSchemas.filter((s) => {
    const matchSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase()) || s.issuer.toLowerCase().includes(searchQuery.toLowerCase());
    const matchCategory = selectedCategory === 'All' || s.category === selectedCategory;
    const matchJurisdiction = selectedJurisdiction === 'All' || s.jurisdictions.includes(selectedJurisdiction);
    return matchSearch && matchCategory && matchJurisdiction;
  });

  const featuredSchemas = credentialSchemas.filter((s) => s.featured);

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <Store className="w-7 h-7 text-identity-amber" />
              Credential Marketplace
            </h1>
            <p className="text-[var(--text-secondary)] mt-1">
              Browse verified credential schemas, discover trusted issuers, and request credentials
            </p>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Credential Schemas', value: String(credentialSchemas.length), icon: FileText, color: 'text-brand-400', trend: '+3 this month' },
            { label: 'Verified Issuers', value: String(issuers.length), icon: BadgeCheck, color: 'text-emerald-400', trend: 'All audited' },
            { label: 'Total Verifications', value: '1.3M', icon: ShieldCheck, color: 'text-identity-chrome', trend: '+42% growth' },
            { label: 'Avg Trust Score', value: '93', icon: Star, color: 'text-identity-amber', trend: 'Network minimum: 85' },
          ].map((m, i) => (
            <motion.div
              key={m.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-zero-900 border border-zero-800 rounded-2xl p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <m.icon className={`w-4 h-4 ${m.color}`} />
                <span className="text-xs text-zero-500">{m.label}</span>
              </div>
              <div className="text-xl font-bold">{m.value}</div>
              <div className="text-xs text-zero-500 mt-1">{m.trend}</div>
            </motion.div>
          ))}
        </div>

        {/* Featured */}
        <div>
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Award className="w-4 h-4 text-identity-amber" /> Featured Credentials
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {featuredSchemas.map((schema, i) => (
              <motion.div
                key={schema.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="card p-5 border-identity-amber/20 hover:border-identity-amber/40 transition-all cursor-pointer group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-identity-amber/20 to-brand-600/20 border border-identity-amber/20 flex items-center justify-center">
                    <Fingerprint className="w-5 h-5 text-identity-amber" />
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-identity-amber/10 text-identity-amber text-[10px] font-medium border border-identity-amber/20">Featured</span>
                </div>
                <h3 className="font-semibold text-sm group-hover:text-brand-400 transition-colors">{schema.name}</h3>
                <p className="text-xs text-zero-500 mt-1 line-clamp-2">{schema.description}</p>
                <div className="flex items-center gap-3 mt-3 text-xs text-zero-400">
                  <span className="flex items-center gap-1"><Star className="w-3 h-3 text-identity-amber" />{schema.trustScore}</span>
                  <span>{(schema.verifications / 1000).toFixed(0)}k verified</span>
                  <span className="ml-auto font-medium text-emerald-400">{schema.price}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Section Toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSection('schemas')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${activeSection === 'schemas' ? 'bg-brand-600 text-white' : 'bg-zero-900 border border-zero-800 text-zero-400 hover:text-white'}`}
          >
            Credential Schemas
          </button>
          <button
            onClick={() => setActiveSection('issuers')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${activeSection === 'issuers' ? 'bg-brand-600 text-white' : 'bg-zero-900 border border-zero-800 text-zero-400 hover:text-white'}`}
          >
            Issuer Leaderboard
          </button>
        </div>

        <AnimatePresence mode="wait">
          {activeSection === 'schemas' && (
            <motion.div key="schemas" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
              {/* Search + Filters */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[250px] relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zero-500" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search credentials or issuers..."
                    className="w-full pl-10 pr-4 py-2.5 bg-zero-900 border border-zero-800 rounded-xl text-sm focus:outline-none focus:border-brand-500"
                  />
                </div>
                <div className="flex items-center gap-2">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-3 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap ${
                        selectedCategory === cat ? 'bg-brand-600 text-white' : 'bg-zero-900 border border-zero-800 text-zero-400 hover:text-white'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                <select
                  value={selectedJurisdiction}
                  onChange={(e) => setSelectedJurisdiction(e.target.value)}
                  className="px-3 py-2.5 bg-zero-900 border border-zero-800 rounded-xl text-xs focus:outline-none focus:border-brand-500"
                >
                  <option value="All">All Jurisdictions</option>
                  <option value="US">United States</option>
                  <option value="EU">European Union</option>
                  <option value="UAE">UAE</option>
                  <option value="UK">United Kingdom</option>
                  <option value="SG">Singapore</option>
                  <option value="Global">Global</option>
                </select>
                <div className="flex items-center bg-zero-900 border border-zero-800 rounded-xl overflow-hidden">
                  <button onClick={() => setViewMode('grid')} className={`p-2.5 ${viewMode === 'grid' ? 'bg-brand-600 text-white' : 'text-zero-500 hover:text-white'}`}>
                    <Grid3X3 className="w-4 h-4" />
                  </button>
                  <button onClick={() => setViewMode('list')} className={`p-2.5 ${viewMode === 'list' ? 'bg-brand-600 text-white' : 'text-zero-500 hover:text-white'}`}>
                    <List className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Results */}
              {viewMode === 'grid' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredSchemas.map((schema, i) => (
                    <motion.div
                      key={schema.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="card p-5 hover:border-zero-600 transition-all cursor-pointer group"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <span className="px-2 py-0.5 rounded-full bg-zero-800 text-[10px] text-zero-400">{schema.category}</span>
                        <span className="font-medium text-sm text-emerald-400">{schema.price}</span>
                      </div>
                      <h3 className="font-semibold text-sm group-hover:text-brand-400 transition-colors">{schema.name}</h3>
                      <p className="text-xs text-zero-500 mt-1 line-clamp-2">{schema.description}</p>
                      <div className="flex items-center gap-1 mt-2">
                        {schema.jurisdictions.slice(0, 3).map((j) => (
                          <span key={j} className="px-1.5 py-0.5 rounded bg-zero-800 text-[9px] text-zero-400">{j}</span>
                        ))}
                        {schema.jurisdictions.length > 3 && (
                          <span className="px-1.5 py-0.5 rounded bg-zero-800 text-[9px] text-zero-400">+{schema.jurisdictions.length - 3}</span>
                        )}
                      </div>
                      <div className="border-t border-zero-800/50 mt-3 pt-3 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs text-zero-400">
                          <span className="flex items-center gap-1"><Star className="w-3 h-3 text-identity-amber" />{schema.trustScore}</span>
                          <span>{(schema.verifications / 1000).toFixed(0)}k</span>
                        </div>
                        <span className="text-[10px] text-zero-500">{schema.issuer.split(' ').slice(0, 2).join(' ')}</span>
                      </div>
                      <div className="mt-2">
                        <span className="text-[10px] text-zero-600">Stake: {schema.staking}</span>
                      </div>
                      <button className="mt-3 w-full py-2 rounded-lg bg-brand-600/10 hover:bg-brand-600 text-brand-400 hover:text-white text-xs font-medium transition-all">
                        Request Credential
                      </button>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="card divide-y divide-zero-800/50">
                  {filteredSchemas.map((schema, i) => (
                    <motion.div
                      key={schema.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.03 }}
                      className="p-4 flex items-center gap-4 hover:bg-zero-800/20 transition-colors cursor-pointer"
                    >
                      <Fingerprint className="w-5 h-5 text-brand-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{schema.name}</div>
                        <div className="text-xs text-zero-500">{schema.issuer} | {schema.category}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        {schema.jurisdictions.slice(0, 2).map((j) => (
                          <span key={j} className="px-1.5 py-0.5 rounded bg-zero-800 text-[9px] text-zero-400">{j}</span>
                        ))}
                      </div>
                      <span className="text-xs text-zero-400"><Star className="w-3 h-3 inline mr-1 text-identity-amber" />{schema.trustScore}</span>
                      <span className="text-xs text-zero-500">{(schema.verifications / 1000).toFixed(0)}k</span>
                      <span className="font-medium text-sm text-emerald-400">{schema.price}</span>
                      <button className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs transition-colors">Request</button>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* Issuer Leaderboard */}
          {activeSection === 'issuers' && (
            <motion.div key="issuers" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="card">
                <div className="p-4 border-b border-zero-800 flex items-center gap-2">
                  <Award className="w-4 h-4 text-identity-amber" />
                  <h2 className="font-semibold">Issuer Leaderboard</h2>
                </div>
                <div className="divide-y divide-zero-800/50">
                  {issuers.map((issuer, i) => (
                    <motion.div
                      key={issuer.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      onClick={() => setShowIssuerDetail(showIssuerDetail === issuer.id ? null : issuer.id)}
                      className="p-5 hover:bg-zero-800/20 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                          i === 0 ? 'bg-identity-amber/20 text-identity-amber' :
                          i === 1 ? 'bg-zero-400/20 text-zero-300' :
                          i === 2 ? 'bg-orange-500/20 text-orange-400' :
                          'bg-zero-700/50 text-zero-400'
                        }`}>
                          #{i + 1}
                        </div>
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-600/20 to-identity-chrome/20 border border-brand-500/10 flex items-center justify-center">
                          <Building2 className="w-6 h-6 text-brand-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{issuer.name}</span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                              issuer.badge === 'Founding Issuer' ? 'bg-brand-500/20 text-brand-400' :
                              issuer.badge === 'Top Issuer' ? 'bg-identity-amber/20 text-identity-amber' :
                              issuer.badge === 'Government Partner' ? 'bg-identity-steel/20 text-identity-steel' :
                              'bg-emerald-500/20 text-emerald-400'
                            }`}>{issuer.badge}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            {issuer.specializations.map((s) => (
                              <span key={s} className="px-1.5 py-0.5 rounded bg-zero-800 text-[9px] text-zero-400">{s}</span>
                            ))}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="flex items-center gap-1">
                            <Star className="w-4 h-4 text-identity-amber" />
                            <span className="font-bold text-lg">{issuer.trustScore}</span>
                          </div>
                          <div className="text-xs text-zero-500">{(issuer.verifications / 1000).toFixed(0)}k verifications</div>
                        </div>
                      </div>

                      <AnimatePresence>
                        {showIssuerDetail === issuer.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-4 ml-20 p-4 bg-zero-800/30 rounded-xl grid grid-cols-3 gap-4">
                              <div>
                                <div className="text-xs text-zero-500 mb-1">Joined</div>
                                <div className="text-sm font-medium">{issuer.joined}</div>
                              </div>
                              <div>
                                <div className="text-xs text-zero-500 mb-1">Schemas Published</div>
                                <div className="text-sm font-medium">{credentialSchemas.filter((s) => s.issuer === issuer.name).length}</div>
                              </div>
                              <div>
                                <div className="text-xs text-zero-500 mb-1">Avg Response Time</div>
                                <div className="text-sm font-medium text-emerald-400">&lt;2s</div>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppLayout>
  );
}
