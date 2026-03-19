"use client";

import React from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

type TrendDirection = "up" | "down" | "neutral";

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  trend?: {
    direction: TrendDirection;
    value: string;
    label?: string;
  };
  subtitle?: string;
  iconColor?: string;
  loading?: boolean;
  className?: string;
  onClick?: () => void;
}

const TREND_CONFIG: Record<
  TrendDirection,
  { icon: React.ReactNode; color: string }
> = {
  up: { icon: <TrendingUp className="w-3 h-3" />, color: "text-emerald-400" },
  down: { icon: <TrendingDown className="w-3 h-3" />, color: "text-rose-400" },
  neutral: { icon: <Minus className="w-3 h-3" />, color: "text-zero-400" },
};

export function MetricCard({
  icon,
  label,
  value,
  trend,
  subtitle,
  iconColor,
  loading = false,
  className = "",
  onClick,
}: MetricCardProps) {
  const trendConfig = trend ? TREND_CONFIG[trend.direction] : null;
  const Component = onClick ? "button" : "div";
  const interactiveClass = onClick ? "cursor-pointer active:scale-[0.98]" : "";

  if (loading) {
    return (
      <div className={`bento p-6 ${className}`} aria-hidden="true">
        <div
          className="w-10 h-10 rounded-xl animate-pulse mb-5"
          style={{ background: "rgba(255,255,255,0.04)" }}
        />
        <div
          className="w-20 h-3 rounded-lg animate-pulse mb-3"
          style={{ background: "rgba(255,255,255,0.04)" }}
        />
        <div
          className="w-16 h-8 rounded-lg animate-pulse"
          style={{ background: "rgba(255,255,255,0.04)" }}
        />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <Component
        className={`w-full text-left bento p-6 group ${interactiveClass} ${className}`}
        onClick={onClick}
      >
        {/* Icon */}
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center mb-5 text-chrome-300"
          style={{
            background: "rgba(192, 196, 204, 0.06)",
            border: "1px solid rgba(192, 196, 204, 0.08)",
          }}
        >
          {icon}
        </div>

        {/* Label */}
        <p className="text-label-sm text-zero-500 mb-2 uppercase font-body">
          {label}
        </p>

        {/* Value — Big and bold */}
        <div className="flex items-end justify-between">
          <p className="text-[36px] font-bold text-white tracking-tight font-display leading-none">
            {value}
          </p>

          {trendConfig && trend && (
            <div
              className={`flex items-center gap-1 text-[11px] font-medium ${trendConfig.color} pb-1`}
            >
              {trendConfig.icon}
              <span className="font-body">{trend.value}</span>
            </div>
          )}
        </div>

        {/* Subtitle */}
        {(subtitle || trend?.label) && (
          <p className="text-[11px] text-zero-500 mt-2.5 font-body">
            {subtitle || trend?.label}
          </p>
        )}
      </Component>
    </motion.div>
  );
}

// ============================================================
// MetricCardGrid
// ============================================================

interface MetricCardGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}

const GRID_COLS: Record<number, string> = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};

export function MetricCardGrid({
  children,
  columns = 4,
  className = "",
}: MetricCardGridProps) {
  return (
    <div className={`grid ${GRID_COLS[columns]} gap-4 ${className}`}>
      {children}
    </div>
  );
}
