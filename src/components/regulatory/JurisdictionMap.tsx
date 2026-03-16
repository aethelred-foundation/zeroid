'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe,
  ZoomIn,
  ZoomOut,
  Maximize2,
  X,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Clock,
  AlertTriangle,
  ArrowRight,
  Loader2,
  ChevronRight,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

type ComplianceStatus = 'compliant' | 'partial' | 'non_compliant' | 'pending';

interface JurisdictionDetail {
  id: string;
  name: string;
  region: string;
  status: ComplianceStatus;
  score: number;
  regulations: string[];
  lastReview: string;
  requirements: { name: string; met: boolean }[];
  notes?: string;
}

interface CrossBorderRoute {
  from: string;
  to: string;
  compliant: boolean;
  requirements: string[];
}

interface JurisdictionMapProps {
  jurisdictions?: JurisdictionDetail[];
  routes?: CrossBorderRoute[];
  loading?: boolean;
  error?: string | null;
  onJurisdictionClick?: (jurisdiction: JurisdictionDetail) => void;
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const STATUS_CONFIG: Record<
  ComplianceStatus,
  { label: string; color: string; bg: string; fill: string; icon: typeof Shield }
> = {
  compliant: { label: 'Compliant', color: 'text-emerald-400', bg: 'bg-emerald-500/10', fill: '#10b981', icon: ShieldCheck },
  partial: { label: 'Partial', color: 'text-amber-400', bg: 'bg-amber-500/10', fill: '#f59e0b', icon: AlertTriangle },
  non_compliant: { label: 'Non-Compliant', color: 'text-red-400', bg: 'bg-red-500/10', fill: '#ef4444', icon: ShieldAlert },
  pending: { label: 'Pending Review', color: 'text-blue-400', bg: 'bg-blue-500/10', fill: '#3b82f6', icon: Clock },
};

// Simplified SVG region paths for major jurisdictions
const REGION_PATHS: Record<string, { path: string; cx: number; cy: number; label: string }> = {
  US: { path: 'M60,120 L180,120 L180,180 L60,180 Z', cx: 120, cy: 150, label: 'United States' },
  CA: { path: 'M70,70 L170,70 L170,115 L70,115 Z', cx: 120, cy: 92, label: 'Canada' },
  EU: { path: 'M340,100 L430,100 L430,160 L340,160 Z', cx: 385, cy: 130, label: 'European Union' },
  UK: { path: 'M310,90 L335,90 L335,120 L310,120 Z', cx: 322, cy: 105, label: 'United Kingdom' },
  CH: { path: 'M365,145 L385,145 L385,160 L365,160 Z', cx: 375, cy: 152, label: 'Switzerland' },
  SG: { path: 'M560,230 L585,230 L585,250 L560,250 Z', cx: 572, cy: 240, label: 'Singapore' },
  JP: { path: 'M620,130 L650,130 L650,165 L620,165 Z', cx: 635, cy: 147, label: 'Japan' },
  AU: { path: 'M580,290 L660,290 L660,350 L580,350 Z', cx: 620, cy: 320, label: 'Australia' },
  AE: { path: 'M465,195 L495,195 L495,215 L465,215 Z', cx: 480, cy: 205, label: 'UAE' },
  HK: { path: 'M590,185 L615,185 L615,205 L590,205 Z', cx: 602, cy: 195, label: 'Hong Kong' },
  BR: { path: 'M180,250 L260,250 L260,320 L180,320 Z', cx: 220, cy: 285, label: 'Brazil' },
  IN: { path: 'M510,165 L555,165 L555,225 L510,225 Z', cx: 532, cy: 195, label: 'India' },
  KR: { path: 'M610,130 L625,130 L625,155 L610,155 Z', cx: 617, cy: 142, label: 'South Korea' },
  ZA: { path: 'M390,300 L430,300 L430,340 L390,340 Z', cx: 410, cy: 320, label: 'South Africa' },
};

const DEFAULT_JURISDICTIONS: JurisdictionDetail[] = Object.keys(REGION_PATHS).map((id) => ({
  id,
  name: REGION_PATHS[id].label,
  region: id,
  status: (['compliant', 'partial', 'non_compliant', 'pending'] as ComplianceStatus[])[
    Math.floor(Math.random() * 4)
  ],
  score: Math.floor(Math.random() * 40) + 60,
  regulations: ['KYC/AML', 'Data Privacy', 'Cross-border Transfer'].slice(0, Math.floor(Math.random() * 3) + 1),
  lastReview: new Date(Date.now() - Math.random() * 90 * 86400000).toISOString().split('T')[0],
  requirements: [
    { name: 'KYC Verification', met: Math.random() > 0.3 },
    { name: 'AML Screening', met: Math.random() > 0.3 },
    { name: 'Data Localization', met: Math.random() > 0.5 },
    { name: 'Credential Recognition', met: Math.random() > 0.4 },
  ],
}));

const DEFAULT_ROUTES: CrossBorderRoute[] = [
  { from: 'US', to: 'EU', compliant: true, requirements: ['eIDAS 2.0 mapping', 'Privacy Shield'] },
  { from: 'US', to: 'UK', compliant: true, requirements: ['UK GDPR alignment'] },
  { from: 'EU', to: 'SG', compliant: false, requirements: ['MAS credential recognition', 'PDPA compliance'] },
  { from: 'JP', to: 'AU', compliant: true, requirements: ['APEC CBPR framework'] },
  { from: 'HK', to: 'SG', compliant: true, requirements: ['ASEAN framework'] },
];

// ============================================================================
// Sub-components
// ============================================================================

function JurisdictionSidebar({
  jurisdiction,
  onClose,
}: {
  jurisdiction: JurisdictionDetail;
  onClose: () => void;
}) {
  const status = STATUS_CONFIG[jurisdiction.status];
  const StatusIcon = status.icon;
  const metRequirements = jurisdiction.requirements.filter((r) => r.met).length;
  const totalRequirements = jurisdiction.requirements.length;

  return (
    <motion.div
      className="absolute right-0 top-0 bottom-0 w-80 border-l border-[var(--border-primary)] bg-[var(--surface-elevated)] z-20 overflow-y-auto"
      initial={{ x: 320 }}
      animate={{ x: 0 }}
      exit={{ x: 320 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      <div className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">
              {jurisdiction.name}
            </h4>
            <div className={`flex items-center gap-1.5 mt-1 ${status.color}`}>
              <StatusIcon className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">{status.label}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--surface-secondary)] transition-colors">
            <X className="w-4 h-4 text-[var(--text-tertiary)]" />
          </button>
        </div>

        {/* Score */}
        <div className="p-4 rounded-xl bg-[var(--surface-secondary)] mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--text-tertiary)]">Compliance Score</span>
            <span className="text-lg font-bold text-[var(--text-primary)]">{jurisdiction.score}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-[var(--surface-tertiary)]">
            <motion.div
              className={`h-full rounded-full ${jurisdiction.score >= 80 ? 'bg-emerald-500' : jurisdiction.score >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
              initial={{ width: 0 }}
              animate={{ width: `${jurisdiction.score}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          </div>
        </div>

        {/* Regulations */}
        <div className="mb-4">
          <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
            Applicable Regulations
          </p>
          <div className="flex flex-wrap gap-1.5">
            {jurisdiction.regulations.map((reg) => (
              <span
                key={reg}
                className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-brand-500/10 text-brand-500"
              >
                {reg}
              </span>
            ))}
          </div>
        </div>

        {/* Requirements checklist */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">
              Requirements
            </p>
            <span className="text-[10px] text-[var(--text-tertiary)]">
              {metRequirements}/{totalRequirements} met
            </span>
          </div>
          <div className="space-y-1.5">
            {jurisdiction.requirements.map((req) => (
              <div
                key={req.name}
                className="flex items-center gap-2 p-2.5 rounded-lg bg-[var(--surface-secondary)]"
              >
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                    req.met ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {req.met ? (
                    <ShieldCheck className="w-3 h-3" />
                  ) : (
                    <X className="w-3 h-3" />
                  )}
                </div>
                <span className="text-xs text-[var(--text-primary)]">{req.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Last review */}
        <div className="p-3 rounded-xl bg-[var(--surface-secondary)]">
          <p className="text-[10px] text-[var(--text-tertiary)]">Last Reviewed</p>
          <p className="text-xs text-[var(--text-primary)]">
            {new Date(jurisdiction.lastReview).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function JurisdictionMap({
  jurisdictions = DEFAULT_JURISDICTIONS,
  routes = DEFAULT_ROUTES,
  loading = false,
  error = null,
  onJurisdictionClick,
  className = '',
}: JurisdictionMapProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showRoutes, setShowRoutes] = useState(true);

  const jurisdictionMap = useMemo(() => {
    const map = new Map<string, JurisdictionDetail>();
    for (const j of jurisdictions) map.set(j.id, j);
    return map;
  }, [jurisdictions]);

  const selectedJurisdiction = useMemo(
    () => (selectedId ? jurisdictionMap.get(selectedId) ?? null : null),
    [selectedId, jurisdictionMap]
  );

  const handleJurisdictionClick = useCallback(
    (id: string) => {
      setSelectedId((prev) => (prev === id ? null : id));
      const j = jurisdictionMap.get(id);
      if (j) onJurisdictionClick?.(j);
    },
    [jurisdictionMap, onJurisdictionClick]
  );

  if (loading) {
    return (
      <div className={`card p-8 flex items-center justify-center gap-2 ${className}`}>
        <Loader2 className="w-5 h-5 animate-spin text-brand-500" />
        <span className="text-sm text-[var(--text-secondary)]">Loading jurisdiction data...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`card p-6 border-red-500/30 ${className}`}>
        <div className="flex items-center gap-2 text-red-400">
          <AlertTriangle className="w-5 h-5" />
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)] overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)]">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-brand-500" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Jurisdiction Map</h3>
          <span className="text-[10px] text-[var(--text-tertiary)]">
            {jurisdictions.length} jurisdictions
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowRoutes(!showRoutes)}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${
              showRoutes ? 'bg-brand-500/20 text-brand-500' : 'bg-[var(--surface-secondary)] text-[var(--text-tertiary)]'
            }`}
          >
            Routes
          </button>
          <button onClick={() => setZoom((z) => Math.max(z - 0.2, 0.5))} className="p-1.5 rounded-lg hover:bg-[var(--surface-secondary)] transition-colors">
            <ZoomOut className="w-4 h-4 text-[var(--text-tertiary)]" />
          </button>
          <button onClick={() => setZoom((z) => Math.min(z + 0.2, 2))} className="p-1.5 rounded-lg hover:bg-[var(--surface-secondary)] transition-colors">
            <ZoomIn className="w-4 h-4 text-[var(--text-tertiary)]" />
          </button>
          <button onClick={() => setZoom(1)} className="p-1.5 rounded-lg hover:bg-[var(--surface-secondary)] transition-colors">
            <Maximize2 className="w-4 h-4 text-[var(--text-tertiary)]" />
          </button>
        </div>
      </div>

      {/* Map area */}
      <div className="relative" style={{ height: selectedJurisdiction ? 420 : 420 }}>
        <svg
          viewBox="0 0 720 400"
          className="w-full h-full"
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
        >
          {/* World outline simplified background */}
          <rect x="0" y="0" width="720" height="400" fill="transparent" />
          <line x1="0" y1="200" x2="720" y2="200" stroke="var(--border-primary)" strokeWidth="0.5" strokeDasharray="4 4" opacity="0.3" />
          <line x1="360" y1="0" x2="360" y2="400" stroke="var(--border-primary)" strokeWidth="0.5" strokeDasharray="4 4" opacity="0.3" />

          {/* Cross-border routes */}
          {showRoutes &&
            routes.map((route) => {
              const from = REGION_PATHS[route.from];
              const to = REGION_PATHS[route.to];
              if (!from || !to) return null;
              return (
                <g key={`${route.from}-${route.to}`}>
                  <line
                    x1={from.cx}
                    y1={from.cy}
                    x2={to.cx}
                    y2={to.cy}
                    stroke={route.compliant ? '#10b981' : '#ef4444'}
                    strokeWidth="1.5"
                    strokeDasharray={route.compliant ? 'none' : '6 3'}
                    opacity="0.4"
                  />
                  <circle
                    cx={(from.cx + to.cx) / 2}
                    cy={(from.cy + to.cy) / 2}
                    r="4"
                    fill={route.compliant ? '#10b981' : '#ef4444'}
                    opacity="0.6"
                  />
                </g>
              );
            })}

          {/* Jurisdiction regions */}
          {Object.entries(REGION_PATHS).map(([id, region]) => {
            const jurisdiction = jurisdictionMap.get(id);
            const status = jurisdiction ? STATUS_CONFIG[jurisdiction.status] : STATUS_CONFIG.pending;
            const isSelected = selectedId === id;
            const isHovered = hoveredId === id;

            return (
              <g
                key={id}
                onClick={() => handleJurisdictionClick(id)}
                onMouseEnter={() => setHoveredId(id)}
                onMouseLeave={() => setHoveredId(null)}
                className="cursor-pointer"
              >
                <motion.path
                  d={region.path}
                  fill={status.fill}
                  fillOpacity={isSelected ? 0.6 : isHovered ? 0.45 : 0.25}
                  stroke={isSelected ? '#fff' : status.fill}
                  strokeWidth={isSelected ? 2 : 1}
                  strokeOpacity={isSelected ? 0.8 : 0.5}
                  rx="4"
                  animate={{
                    fillOpacity: isSelected ? 0.6 : isHovered ? 0.45 : 0.25,
                    strokeWidth: isSelected ? 2 : 1,
                  }}
                  transition={{ duration: 0.2 }}
                />
                <text
                  x={region.cx}
                  y={region.cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="white"
                  fontSize="11"
                  fontWeight="600"
                  opacity={isSelected || isHovered ? 1 : 0.7}
                  className="pointer-events-none select-none"
                >
                  {id}
                </text>
                {jurisdiction && (
                  <text
                    x={region.cx}
                    y={region.cy + 14}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="white"
                    fontSize="8"
                    opacity={isHovered || isSelected ? 0.8 : 0}
                    className="pointer-events-none select-none"
                  >
                    {jurisdiction.score}%
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Sidebar */}
        <AnimatePresence>
          {selectedJurisdiction && (
            <JurisdictionSidebar
              jurisdiction={selectedJurisdiction}
              onClose={() => setSelectedId(null)}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 px-5 py-3 border-t border-[var(--border-primary)]">
        {Object.entries(STATUS_CONFIG).map(([key, config]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: config.fill, opacity: 0.4 }} />
            <span className="text-[10px] text-[var(--text-tertiary)]">{config.label}</span>
          </div>
        ))}
        {showRoutes && (
          <>
            <div className="w-px h-3 bg-[var(--border-primary)]" />
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-0.5 bg-emerald-500 rounded" />
              <span className="text-[10px] text-[var(--text-tertiary)]">Compliant Route</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-0.5 bg-red-500 rounded" style={{ borderTop: '1.5px dashed #ef4444' }} />
              <span className="text-[10px] text-[var(--text-tertiary)]">Non-Compliant</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
