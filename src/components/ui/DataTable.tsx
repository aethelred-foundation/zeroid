"use client";

import React, { useState, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Inbox,
} from "lucide-react";

import { EmptyState } from "./EmptyState";

// ============================================================
// DataTable Types
// ============================================================

export type SortDirection = "asc" | "desc" | null;

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  width?: string;
  align?: "left" | "center" | "right";
  render?: (value: unknown, row: T, index: number) => React.ReactNode;
  accessor?: (row: T) => unknown;
}

interface SortState {
  column: string | null;
  direction: SortDirection;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T, index: number) => string;
  pageSize?: number;
  sortable?: boolean;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: {
    label: string;
    onClick: () => void;
  };
  onRowClick?: (row: T, index: number) => void;
  className?: string;
  stickyHeader?: boolean;
}

// ============================================================
// Sort Icon Component
// ============================================================

function SortIcon({ direction }: { direction: SortDirection }) {
  if (direction === "asc") {
    return <ChevronUp className="w-3.5 h-3.5 text-cyan-400" />;
  }
  if (direction === "desc") {
    return <ChevronDown className="w-3.5 h-3.5 text-cyan-400" />;
  }
  return <ChevronsUpDown className="w-3.5 h-3.5 text-zero-600" />;
}

// ============================================================
// Pagination Component
// ============================================================

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
}: PaginationProps) {
  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  const getVisiblePages = (): (number | "ellipsis")[] => {
    const pages: (number | "ellipsis")[] = [];

    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
      return pages;
    }

    pages.push(1);

    if (currentPage > 3) {
      pages.push("ellipsis");
    }

    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (currentPage < totalPages - 2) {
      pages.push("ellipsis");
    }

    pages.push(totalPages);

    return pages;
  };

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-zero-800">
      {/* Item count */}
      <span className="text-xs text-zero-500">
        Showing {startItem}-{endItem} of {totalItems} results
      </span>

      {/* Page controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="p-1.5 rounded-lg hover:bg-zero-800 text-zero-400 disabled:text-zero-700 disabled:cursor-not-allowed transition-colors"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {getVisiblePages().map((page, i) =>
          page === "ellipsis" ? (
            <span
              key={`ellipsis-${i}`}
              className="px-1.5 text-zero-600 text-sm"
            >
              ...
            </span>
          ) : (
            <button
              key={page}
              onClick={() => onPageChange(page)}
              className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                currentPage === page
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                  : "text-zero-400 hover:bg-zero-800 hover:text-zero-200"
              }`}
            >
              {page}
            </button>
          ),
        )}

        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="p-1.5 rounded-lg hover:bg-zero-800 text-zero-400 disabled:text-zero-700 disabled:cursor-not-allowed transition-colors"
          aria-label="Next page"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ============================================================
// DataTable Component
// ============================================================

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  pageSize = 10,
  sortable = true,
  loading = false,
  emptyTitle = "No data found",
  emptyDescription = "There are no records to display.",
  emptyAction,
  onRowClick,
  className = "",
  stickyHeader = false,
}: DataTableProps<T>) {
  const [sortState, setSortState] = useState<SortState>({
    column: null,
    direction: null,
  });
  const [currentPage, setCurrentPage] = useState(1);

  // Handle column sort
  const handleSort = useCallback(
    (columnKey: string) => {
      setSortState((prev) => {
        if (prev.column === columnKey) {
          if (prev.direction === "asc")
            return { column: columnKey, direction: "desc" };
          if (prev.direction === "desc")
            return { column: null, direction: null };
        }
        return { column: columnKey, direction: "asc" };
      });
      setCurrentPage(1);
    },
    [sortable],
  );

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortState.column || !sortState.direction) return data;

    const column = columns.find((c) => c.key === sortState.column);
    if (!column) return data;

    return [...data].sort((a, b) => {
      const aVal = column.accessor
        ? column.accessor(a)
        : (a as Record<string, unknown>)[sortState.column as string];
      const bVal = column.accessor
        ? column.accessor(b)
        : (b as Record<string, unknown>)[sortState.column as string];

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      let comparison = 0;
      if (typeof aVal === "string" && typeof bVal === "string") {
        comparison = aVal.localeCompare(bVal);
      } else if (typeof aVal === "number" && typeof bVal === "number") {
        comparison = aVal - bVal;
      } else {
        comparison = String(aVal).localeCompare(String(bVal));
      }

      return sortState.direction === "desc" ? -comparison : comparison;
    });
  }, [data, sortState, columns]);

  // Paginate
  const totalPages = Math.max(1, Math.ceil(sortedData.length / pageSize));
  const paginatedData = sortedData.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  // Loading state
  if (loading) {
    return (
      <div
        className={`bg-zero-900 border border-zero-800 rounded-2xl overflow-hidden ${className}`}
      >
        <div className="space-y-0">
          {/* Header skeleton */}
          <div className="flex gap-4 px-4 py-3 border-b border-zero-800">
            {columns.map((col) => (
              <div
                key={col.key}
                className="animate-pulse bg-zero-800 rounded h-4 flex-1"
              />
            ))}
          </div>
          {/* Row skeletons */}
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex gap-4 px-4 py-3.5 border-b border-zero-800/50"
            >
              {columns.map((col) => (
                <div
                  key={col.key}
                  className="animate-pulse bg-zero-800/70 rounded h-5 flex-1"
                  style={{ opacity: 1 - i * 0.15 }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Empty state
  if (data.length === 0) {
    return (
      <div
        className={`bg-zero-900 border border-zero-800 rounded-2xl overflow-hidden ${className}`}
      >
        <EmptyState
          icon={<Inbox className="w-7 h-7 text-zero-500" />}
          title={emptyTitle}
          description={emptyDescription}
          action={emptyAction}
          size="md"
        />
      </div>
    );
  }

  const alignClass = (align?: string) => {
    switch (align) {
      case "center":
        return "text-center";
      case "right":
        return "text-right";
      default:
        return "text-left";
    }
  };

  return (
    <div
      className={`bg-zero-900 border border-zero-800 rounded-2xl overflow-hidden ${className}`}
    >
      <div className="overflow-x-auto">
        <table className="w-full">
          {/* Table header */}
          <thead>
            <tr
              className={`border-b border-zero-800 ${stickyHeader ? "sticky top-0 bg-zero-900 z-10" : ""}`}
            >
              {columns.map((column) => {
                const isSortable = sortable && column.sortable !== false;
                const currentDirection =
                  sortState.column === column.key ? sortState.direction : null;

                return (
                  <th
                    key={column.key}
                    className={`px-4 py-3 text-xs font-medium text-zero-500 uppercase tracking-wider ${alignClass(column.align)} ${
                      isSortable
                        ? "cursor-pointer select-none hover:text-zero-300"
                        : ""
                    }`}
                    style={column.width ? { width: column.width } : undefined}
                    onClick={() => isSortable && handleSort(column.key)}
                  >
                    <div
                      className={`inline-flex items-center gap-1 ${
                        column.align === "right" ? "flex-row-reverse" : ""
                      }`}
                    >
                      {column.header}
                      {isSortable && <SortIcon direction={currentDirection} />}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* Table body */}
          <tbody>
            {paginatedData.map((row, rowIndex) => {
              const globalIndex = (currentPage - 1) * pageSize + rowIndex;
              return (
                <motion.tr
                  key={keyExtractor(row, globalIndex)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: rowIndex * 0.03 }}
                  className={`border-b border-zero-800/50 last:border-b-0 transition-colors ${
                    onRowClick
                      ? "cursor-pointer hover:bg-zero-800/50"
                      : "hover:bg-zero-800/30"
                  }`}
                  onClick={() => onRowClick?.(row, globalIndex)}
                >
                  {columns.map((column) => {
                    const value = column.accessor
                      ? column.accessor(row)
                      : (row as Record<string, unknown>)[column.key];

                    return (
                      <td
                        key={column.key}
                        className={`px-4 py-3.5 text-sm text-zero-300 ${alignClass(column.align)}`}
                        style={
                          column.width ? { width: column.width } : undefined
                        }
                      >
                        {column.render
                          ? column.render(value, row, globalIndex)
                          : ((value as React.ReactNode) ?? "-")}
                      </td>
                    );
                  })}
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={sortedData.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
        />
      )}
    </div>
  );
}
