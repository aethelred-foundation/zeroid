'use client';

import React from 'react';

// ============================================================
// Base Skeleton
// ============================================================

// ============================================================
// SkeletonText — Multi-line text placeholder
// ============================================================

export function SkeletonText({
  lines = 3,
  className = '',
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-2.5 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse bg-zero-800 rounded h-3"
          style={{ width: i === lines - 1 ? '60%' : i === 0 ? '90%' : '100%' }}
        />
      ))}
    </div>
  );
}

// ============================================================
// SkeletonAvatar — Circular placeholder for avatars/icons
// ============================================================

export function SkeletonAvatar({
  size = 40,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={`animate-pulse bg-zero-800 rounded-full shrink-0 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

// ============================================================
// SkeletonCard — Card-shaped placeholder
// ============================================================

export function SkeletonCard({
  height = '12rem',
  className = '',
}: {
  height?: string;
  className?: string;
}) {
  return (
    <div
      className={`animate-pulse bg-zero-900 border border-zero-800 rounded-2xl ${className}`}
      style={{ height }}
      aria-hidden="true"
    >
      <div className="p-5 h-full flex flex-col justify-between">
        <div className="flex items-start justify-between">
          <div className="w-10 h-10 rounded-xl bg-zero-800" />
          <div className="w-16 h-5 rounded-full bg-zero-800" />
        </div>
        <div className="space-y-2">
          <div className="w-24 h-3 rounded bg-zero-800" />
          <div className="w-32 h-6 rounded bg-zero-800" />
          <div className="w-20 h-3 rounded bg-zero-800" />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SkeletonTable — Table placeholder with rows and columns
// ============================================================

export function SkeletonTable({
  rows = 5,
  columns = 4,
  className = '',
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-0 ${className}`} aria-hidden="true">
      {/* Header row */}
      <div className="flex gap-4 px-4 py-3 border-b border-zero-800">
        {Array.from({ length: columns }).map((_, i) => (
          <div
            key={`header-${i}`}
            className="animate-pulse bg-zero-800 rounded h-4 flex-1"
          />
        ))}
      </div>

      {/* Data rows */}
      {Array.from({ length: rows }).map((_, row) => (
        <div
          key={`row-${row}`}
          className="flex gap-4 px-4 py-3.5 border-b border-zero-800/50"
        >
          {Array.from({ length: columns }).map((_, col) => (
            <div
              key={`cell-${row}-${col}`}
              className="animate-pulse bg-zero-800/70 rounded h-5"
              style={{
                flex: col === 0 ? 2 : 1,
                opacity: 1 - row * 0.08,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// SkeletonMetric — Metric card placeholder
// ============================================================

export function SkeletonMetric({ className = '' }: { className?: string }) {
  return (
    <div
      className={`bg-zero-900 border border-zero-800 rounded-2xl p-5 ${className}`}
      aria-hidden="true"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="animate-pulse w-10 h-10 rounded-xl bg-zero-800" />
        <div className="animate-pulse w-16 h-5 rounded-full bg-zero-800" />
      </div>
      <div className="animate-pulse w-24 h-3 rounded bg-zero-800 mb-2" />
      <div className="animate-pulse w-16 h-7 rounded bg-zero-800 mb-2" />
      <div className="animate-pulse w-20 h-3 rounded bg-zero-800" />
    </div>
  );
}

// ============================================================
// SkeletonBadge — Badge placeholder
// ============================================================

export function SkeletonBadge({
  width = 64,
  className = '',
}: {
  width?: number;
  className?: string;
}) {
  return (
    <div
      className={`animate-pulse bg-zero-800 rounded-full h-5 ${className}`}
      style={{ width }}
      aria-hidden="true"
    />
  );
}

// ============================================================
// SkeletonStats — Grid of stat card placeholders
// ============================================================

export function SkeletonStats({
  count = 4,
  className = '',
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={`grid grid-cols-2 md:grid-cols-4 gap-4 ${className}`}
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonMetric key={i} />
      ))}
    </div>
  );
}

// ============================================================
// SkeletonLine — Single line placeholder
// ============================================================

export function SkeletonLine({
  width = '100%',
  height = '1rem',
  className = '',
}: {
  width?: string;
  height?: string;
  className?: string;
}) {
  return (
    <div
      className={`animate-pulse bg-zero-800 rounded ${className}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
