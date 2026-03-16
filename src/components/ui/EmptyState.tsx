'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Inbox } from 'lucide-react';

// ============================================================
// Empty State Component
// ============================================================

type EmptyStateSize = 'sm' | 'md' | 'lg';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  size?: EmptyStateSize;
  className?: string;
}

const SIZE_CONFIG: Record<
  EmptyStateSize,
  {
    container: string;
    iconWrapper: string;
    iconSize: string;
    title: string;
    description: string;
    button: string;
  }
> = {
  sm: {
    container: 'py-8 px-3',
    iconWrapper: 'w-10 h-10 mb-3',
    iconSize: 'w-5 h-5',
    title: 'text-sm font-semibold',
    description: 'text-xs max-w-xs',
    button: 'mt-4 px-4 py-2 text-xs',
  },
  md: {
    container: 'py-16 px-4',
    iconWrapper: 'w-16 h-16 mb-4',
    iconSize: 'w-7 h-7',
    title: 'text-lg font-semibold',
    description: 'text-sm max-w-sm',
    button: 'mt-6 px-5 py-2.5 text-sm',
  },
  lg: {
    container: 'py-24 px-6',
    iconWrapper: 'w-20 h-20 mb-6',
    iconSize: 'w-9 h-9',
    title: 'text-xl font-bold',
    description: 'text-base max-w-md',
    button: 'mt-8 px-6 py-3 text-sm',
  },
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  size = 'md',
  className = '',
}: EmptyStateProps) {
  const config = SIZE_CONFIG[size];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`flex flex-col items-center justify-center text-center ${config.container} ${className}`}
    >
      {/* Icon */}
      <div
        className={`rounded-full bg-zero-800 border border-zero-700 flex items-center justify-center ${config.iconWrapper}`}
      >
        {icon || <Inbox className={`${config.iconSize} text-zero-500`} />}
      </div>

      {/* Title */}
      <h3 className={`text-white mb-1 ${config.title}`}>{title}</h3>

      {/* Description */}
      {description && (
        <p className={`text-zero-400 ${config.description}`}>{description}</p>
      )}

      {/* Actions */}
      {(action || secondaryAction) && (
        <div className="flex items-center gap-3">
          {action && (
            <button
              onClick={action.onClick}
              className={`inline-flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white rounded-xl font-medium transition-all shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zero-950 ${config.button}`}
            >
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              className={`inline-flex items-center gap-2 border border-zero-700 text-zero-300 hover:bg-zero-800 rounded-xl font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zero-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zero-950 ${config.button}`}
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
