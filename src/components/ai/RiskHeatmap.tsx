'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  Filter,
  ChevronDown,
  Info,
  X,
  Loader2,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

type SeverityLevel = 'low' | 'medium' | 'high' | 'critical';

interface RiskFactor {
  name: string;
  score: number;
  description: string;
}

interface RiskCell {
  category: string;
  jurisdiction: string;
  score: number;
  severity: SeverityLevel;
  factors: RiskFactor[];
  lastUpdated: string;
}

interface RiskHeatmapProps {
  data?: RiskCell[];
  categories?: string[];
  jurisdictions?: string[];
  loading?: boolean;
  error?: string | null;
  onCellClick?: (cell: RiskCell) => void;
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CATEGORIES = [
  'KYC/AML',
  'Sanctions',
  'Data Privacy',
  'Cross-border',
  'Credential Fraud',
  'Identity Theft',
];

const DEFAULT_JURISDICTIONS = [
  'US', 'EU', 'UK', 'SG', 'JP', 'AU', 'CA', 'CH', 'AE', 'HK',
];

const SEVERITY_CONFIG: Record<SeverityLevel, { label: string; color: string; bg: string }> = {
  low: { label: 'Low', color: 'text-emerald-400', bg: 'bg-emerald-500' },
  medium: { label: 'Medium', color: 'text-amber-400', bg: 'bg-amber-500' },
  high: { label: 'High', color: 'text-orange-400', bg: 'bg-orange-500' },
  critical: { label: 'Critical', color: 'text-red-400', bg: 'bg-red-500' },
};

function getSeverity(score: number): SeverityLevel {
  if (score <= 25) return 'low';
  if (score <= 50) return 'medium';
  if (score <= 75) return 'high';
  return 'critical';
}

function getCellColor(score: number): string {
  if (score <= 15) return 'bg-emerald-500/20 hover:bg-emerald-500/30';
  if (score <= 30) return 'bg-emerald-500/40 hover:bg-emerald-500/50';
  if (score <= 45) return 'bg-amber-500/30 hover:bg-amber-500/40';
  if (score <= 60) return 'bg-amber-500/50 hover:bg-amber-500/60';
  if (score <= 75) return 'bg-orange-500/40 hover:bg-orange-500/50';
  if (score <= 90) return 'bg-red-500/40 hover:bg-red-500/50';
  return 'bg-red-500/60 hover:bg-red-500/70';
}

function generateMockData(
  categories: string[],
  jurisdictions: string[]
): RiskCell[] {
  const cells: RiskCell[] = [];
  for (const category of categories) {
    for (const jurisdiction of jurisdictions) {
      const score = Math.floor(Math.random() * 100);
      cells.push({
        category,
        jurisdiction,
        score,
        severity: getSeverity(score),
        factors: [
          { name: 'Regulatory Gap', score: Math.floor(Math.random() * 100), description: 'Missing or outdated regulatory framework' },
          { name: 'Enforcement Risk', score: Math.floor(Math.random() * 100), description: 'Likelihood of enforcement action' },
          { name: 'Data Risk', score: Math.floor(Math.random() * 100), description: 'Risk of data exposure or breach' },
        ],
        lastUpdated: new Date(Date.now() - Math.random() * 7 * 86400000).toISOString(),
      });
    }
  }
  return cells;
}

// ============================================================================
// Sub-components
// ============================================================================

function Tooltip({
  cell,
  position,
}: {
  cell: RiskCell;
  position: { x: number; y: number };
}) {
  const severity = SEVERITY_CONFIG[cell.severity];

  return (
    <motion.div
      className="fixed z-50 w-64 rounded-xl border border-[var(--border-primary)] bg-[var(--surface-elevated)] shadow-2xl p-4"
      style={{ left: position.x + 12, top: position.y - 20 }}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
    >
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-[var(--text-primary)]">
          {cell.jurisdiction} - {cell.category}
        </h4>
        <span className={`text-xs font-medium ${severity.color}`}>
          {cell.score}/100
        </span>
      </div>
      <div className="space-y-2">
        {cell.factors.map((factor) => (
          <div key={factor.name}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-[var(--text-secondary)]">{factor.name}</span>
              <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
                {factor.score}
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-[var(--surface-tertiary)]">
              <motion.div
                className={`h-full rounded-full ${getCellColor(factor.score).split(' ')[0]}`}
                initial={{ width: 0 }}
                animate={{ width: `${factor.score}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-[var(--text-tertiary)] mt-3">
        Updated {new Date(cell.lastUpdated).toLocaleDateString()}
      </p>
    </motion.div>
  );
}

function DrillDownPanel({
  cell,
  onClose,
}: {
  cell: RiskCell;
  onClose: () => void;
}) {
  const severity = SEVERITY_CONFIG[cell.severity];

  return (
    <motion.div
      className="rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-elevated)] p-5 mt-4"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="text-sm font-semibold text-[var(--text-primary)]">
            {cell.jurisdiction} - {cell.category}
          </h4>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-xs font-medium ${severity.color}`}>{severity.label}</span>
            <span className="text-xs text-[var(--text-tertiary)]">Score: {cell.score}/100</span>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--surface-secondary)] transition-colors">
          <X className="w-4 h-4 text-[var(--text-tertiary)]" />
        </button>
      </div>

      <div className="space-y-3">
        {cell.factors.map((factor) => {
          const factorSeverity = SEVERITY_CONFIG[getSeverity(factor.score)];
          return (
            <div
              key={factor.name}
              className="p-3 rounded-xl bg-[var(--surface-secondary)]"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-[var(--text-primary)]">
                  {factor.name}
                </span>
                <span className={`text-xs font-medium ${factorSeverity.color}`}>
                  {factor.score}/100
                </span>
              </div>
              <p className="text-[10px] text-[var(--text-secondary)] mb-2">
                {factor.description}
              </p>
              <div className="w-full h-2 rounded-full bg-[var(--surface-tertiary)]">
                <motion.div
                  className={`h-full rounded-full ${factorSeverity.bg}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${factor.score}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function RiskHeatmap({
  data,
  categories = DEFAULT_CATEGORIES,
  jurisdictions = DEFAULT_JURISDICTIONS,
  loading = false,
  error = null,
  onCellClick,
  className = '',
}: RiskHeatmapProps) {
  const [hoveredCell, setHoveredCell] = useState<RiskCell | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [selectedCell, setSelectedCell] = useState<RiskCell | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [showFilter, setShowFilter] = useState(false);

  const cellData = useMemo(() => {
    return data ?? generateMockData(categories, jurisdictions);
  }, [data, categories, jurisdictions]);

  const displayCategories = useMemo(() => {
    return filterCategory ? [filterCategory] : categories;
  }, [filterCategory, categories]);

  const getCellData = useCallback(
    (category: string, jurisdiction: string): RiskCell | undefined => {
      return cellData.find(
        (c) => c.category === category && c.jurisdiction === jurisdiction
      );
    },
    [cellData]
  );

  const handleMouseEnter = useCallback(
    (cell: RiskCell, e: React.MouseEvent) => {
      setHoveredCell(cell);
      setTooltipPos({ x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleCellClick = useCallback(
    (cell: RiskCell) => {
      setSelectedCell(selectedCell?.category === cell.category && selectedCell?.jurisdiction === cell.jurisdiction ? null : cell);
      onCellClick?.(cell);
    },
    [selectedCell, onCellClick]
  );

  if (loading) {
    return (
      <div className={`card p-8 flex items-center justify-center gap-2 ${className}`}>
        <Loader2 className="w-5 h-5 animate-spin text-brand-500" />
        <span className="text-sm text-[var(--text-secondary)]">Loading risk data...</span>
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
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-brand-500" />
          Risk Heatmap
        </h3>
        <div className="relative">
          <button
            onClick={() => setShowFilter(!showFilter)}
            className="btn-ghost btn-sm"
          >
            <Filter className="w-3.5 h-3.5" />
            {filterCategory ?? 'All Categories'}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showFilter ? 'rotate-180' : ''}`} />
          </button>
          <AnimatePresence>
            {showFilter && (
              <motion.div
                className="absolute right-0 mt-1 z-20 w-48 rounded-xl border border-[var(--border-primary)] bg-[var(--surface-elevated)] shadow-lg overflow-hidden"
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
              >
                <button
                  onClick={() => { setFilterCategory(null); setShowFilter(false); }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-[var(--surface-secondary)] ${
                    !filterCategory ? 'text-brand-500 font-medium' : 'text-[var(--text-secondary)]'
                  }`}
                >
                  All Categories
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => { setFilterCategory(cat); setShowFilter(false); }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-[var(--surface-secondary)] ${
                      filterCategory === cat ? 'text-brand-500 font-medium' : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Heatmap grid */}
      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          {/* Jurisdiction headers */}
          <div className="flex">
            <div className="w-32 flex-shrink-0" />
            {jurisdictions.map((j) => (
              <div
                key={j}
                className="flex-1 text-center text-xs font-medium text-[var(--text-secondary)] pb-2"
              >
                {j}
              </div>
            ))}
          </div>

          {/* Rows */}
          {displayCategories.map((category) => (
            <div key={category} className="flex items-center">
              <div className="w-32 flex-shrink-0 pr-3 text-right">
                <span className="text-xs text-[var(--text-secondary)] truncate block">
                  {category}
                </span>
              </div>
              {jurisdictions.map((jurisdiction) => {
                const cell = getCellData(category, jurisdiction);
                if (!cell) return <div key={jurisdiction} className="flex-1 p-1" />;

                return (
                  <div key={jurisdiction} className="flex-1 p-1">
                    <motion.button
                      className={`w-full aspect-square rounded-lg ${getCellColor(cell.score)} transition-colors flex items-center justify-center cursor-pointer border border-transparent ${
                        selectedCell?.category === cell.category &&
                        selectedCell?.jurisdiction === cell.jurisdiction
                          ? 'border-white/40 ring-2 ring-brand-500/30'
                          : ''
                      }`}
                      onMouseEnter={(e) => handleMouseEnter(cell, e)}
                      onMouseLeave={() => setHoveredCell(null)}
                      onClick={() => handleCellClick(cell)}
                      whileHover={{ scale: 1.08 }}
                      whileTap={{ scale: 0.95 }}
                      layout
                    >
                      <span className="text-[10px] font-mono font-medium text-white/80">
                        {cell.score}
                      </span>
                    </motion.button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 pt-2">
        {Object.entries(SEVERITY_CONFIG).map(([key, config]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded ${config.bg}/60`} />
            <span className="text-[10px] text-[var(--text-tertiary)]">{config.label}</span>
          </div>
        ))}
      </div>

      {/* Tooltip */}
      <AnimatePresence>
        {hoveredCell && !selectedCell && (
          <Tooltip cell={hoveredCell} position={tooltipPos} />
        )}
      </AnimatePresence>

      {/* Drill-down panel */}
      <AnimatePresence>
        {selectedCell && (
          <DrillDownPanel
            cell={selectedCell}
            onClose={() => setSelectedCell(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
