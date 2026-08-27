/**
 * Server-backed audit trail queries and export helpers.
 *
 * Audit action names, resource identifiers, timestamps, and summary values are
 * preserved from the backend. The hook does not synthesize audit events.
 */

import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import type {
  AuditFilter,
  AuditLogEntry,
  CredentialAuditEntry,
  VerificationAuditEntry,
} from "@/types";

type UnknownRecord = Record<string, unknown>;

type BackendAuditSummary = {
  totalEvents?: unknown;
  eventsLast30Days?: unknown;
  actionBreakdown?: unknown;
  lastActivity?: unknown;
};

export type IdentityActivitySummary = {
  totalEvents: number | null;
  eventsLast30Days: number | null;
  actionBreakdown: Array<{ action: string; count: number }>;
  lastActivity: {
    action: string;
    resourceType?: string;
    timestamp?: string;
  } | null;
};

type BackendAuditExport = UnknownRecord & {
  records: UnknownRecord[];
  totalRecords?: number;
};

export class AuditResponseContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditResponseContractError";
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function finiteCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function normalizeTimestamp(value: unknown): string | undefined {
  let date: Date;
  if (typeof value === "number" && Number.isFinite(value)) {
    date = new Date(value > 10_000_000_000 ? value : value * 1000);
  } else if (typeof value === "string" && value.trim()) {
    date = new Date(value);
  } else if (value instanceof Date) {
    date = value;
  } else {
    return undefined;
  }
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalizeAuditEntry(value: unknown): AuditLogEntry | null {
  if (!isRecord(value)) return null;
  const id = nonEmptyString(value.id);
  const action = nonEmptyString(value.action);
  if (!id || !action) return null;

  const resourceType = nonEmptyString(value.resourceType);
  const resourceId = nonEmptyString(value.resourceId);
  const identityId = nonEmptyString(value.identityId);

  return {
    ...value,
    id,
    action,
    type: action,
    actor: identityId,
    entityType: resourceType,
    entityId: resourceId,
    timestamp: normalizeTimestamp(value.timestamp),
  };
}

function normalizeAuditEntries(
  value: unknown,
  endpoint: string,
): AuditLogEntry[] {
  if (!Array.isArray(value)) {
    throw new AuditResponseContractError(
      `${endpoint} returned an invalid audit record collection`,
    );
  }
  return value.flatMap((entry) => {
    const normalized = normalizeAuditEntry(entry);
    return normalized ? [normalized] : [];
  });
}

function appendAuditFilters(
  params: URLSearchParams,
  filters: AuditFilter,
): void {
  if (filters.action) params.set("action", filters.action);
  if (filters.entityType) params.set("resourceType", filters.entityType);
  if (filters.entityId) params.set("resourceId", filters.entityId);
  if (filters.startDate) params.set("from", filters.startDate);
  if (filters.endDate) params.set("to", filters.endDate);
  params.set("page", String(filters.page ?? 1));
  params.set("limit", String(filters.pageSize ?? 50));
}

function normalizeSummary(value: unknown): IdentityActivitySummary {
  if (!isRecord(value)) {
    throw new AuditResponseContractError(
      "The audit summary endpoint returned an invalid response",
    );
  }
  const summary = value as BackendAuditSummary;
  const actionBreakdown = Array.isArray(summary.actionBreakdown)
    ? summary.actionBreakdown.flatMap((item) => {
        if (!isRecord(item)) return [];
        const action = nonEmptyString(item.action);
        const count = finiteCount(item.count);
        return action && count !== null ? [{ action, count }] : [];
      })
    : [];

  let lastActivity: IdentityActivitySummary["lastActivity"] = null;
  if (isRecord(summary.lastActivity)) {
    const action = nonEmptyString(summary.lastActivity.action);
    if (action) {
      lastActivity = {
        action,
        resourceType: nonEmptyString(summary.lastActivity.resourceType),
        timestamp: normalizeTimestamp(summary.lastActivity.timestamp),
      };
    }
  }

  return {
    totalEvents: finiteCount(summary.totalEvents),
    eventsLast30Days: finiteCount(summary.eventsLast30Days),
    actionBreakdown,
    lastActivity,
  };
}

// ---------------------------------------------------------------------------
// General audit log
// ---------------------------------------------------------------------------

export function useAuditLog(filters: AuditFilter = {}, enabled = true) {
  const { address } = useAccount();
  const params = new URLSearchParams();
  appendAuditFilters(params, filters);
  const queryString = params.toString();

  return useQuery({
    queryKey: ["auditLog", address, queryString],
    queryFn: async () => {
      const response = await apiClient.get<unknown>(
        `/api/v1/audit?${queryString}`,
      );
      const entries = normalizeAuditEntries(response, "The audit endpoint");
      return { entries, total: entries.length };
    },
    enabled: enabled && !!address,
    staleTime: 20_000,
  });
}

/** Single page-facing source for the server-filtered audit collection. */
export function useAudit(filters: AuditFilter = {}, enabled = true) {
  const { address } = useAccount();
  const result = useAuditLog(filters, enabled);
  const entries = result.data?.entries ?? [];

  return {
    auditLog: entries,
    events: entries,
    total: result.data?.total ?? 0,
    isConnected: Boolean(address),
    isLoading: result.isLoading,
    isSuccess: result.isSuccess,
    error: result.error,
  };
}

// ---------------------------------------------------------------------------
// Resource-specific trails
// ---------------------------------------------------------------------------

export function useCredentialAudit(credentialId: string | undefined) {
  return useQuery({
    queryKey: ["credentialAudit", credentialId],
    queryFn: async () => {
      const endpoint = `/api/v1/audit/resource/credential/${credentialId}?page=1&limit=100`;
      const response = await apiClient.get<unknown>(endpoint);
      return normalizeAuditEntries(
        response,
        "The credential audit endpoint",
      ) as CredentialAuditEntry[];
    },
    enabled: !!credentialId,
    staleTime: 30_000,
  });
}

export function useVerificationAudit(verificationId: string | undefined) {
  return useQuery({
    queryKey: ["verificationAudit", verificationId],
    queryFn: async () => {
      const endpoint = `/api/v1/audit/resource/verification/${verificationId}?page=1&limit=100`;
      const response = await apiClient.get<unknown>(endpoint);
      return normalizeAuditEntries(
        response,
        "The verification audit endpoint",
      ) as VerificationAuditEntry[];
    },
    enabled: !!verificationId,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Backend-provided summary
// ---------------------------------------------------------------------------

export function useIdentityActivitySummary() {
  const { address } = useAccount();

  return useQuery({
    queryKey: ["identityActivity", address],
    queryFn: async () =>
      normalizeSummary(
        await apiClient.get<unknown>("/api/v1/audit/summary/stats"),
      ),
    enabled: !!address,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function defaultExportWindow(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function normalizeExport(value: unknown): BackendAuditExport {
  if (!isRecord(value) || !Array.isArray(value.records)) {
    throw new AuditResponseContractError(
      "The audit export endpoint returned an invalid response",
    );
  }
  return { ...value, records: value.records.filter(isRecord) };
}

function recordMatchesFilters(
  record: UnknownRecord,
  filters: AuditFilter,
): boolean {
  if (filters.action && record.action !== filters.action) return false;
  if (filters.entityType && record.resourceType !== filters.entityType) {
    return false;
  }
  if (filters.entityId && record.resourceId !== filters.entityId) return false;
  return true;
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function auditExportToCsv(records: UnknownRecord[]): string {
  const headers = [
    "id",
    "timestamp",
    "action",
    "identityId",
    "resourceType",
    "resourceId",
    "ipAddress",
    "details",
  ];
  return [
    headers.join(","),
    ...records.map((record) =>
      headers.map((header) => csvCell(record[header])).join(","),
    ),
  ].join("\n");
}

function downloadAuditExport(payload: string, format: "json" | "csv"): void {
  const blob = new Blob([payload], {
    type: format === "json" ? "application/json" : "text/csv",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `zeroid-audit-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function exportAuditLog(
  filters: AuditFilter = {},
  format: "json" | "csv" = "json",
): Promise<void> {
  try {
    const params = new URLSearchParams();
    const exportWindow = defaultExportWindow();
    params.set("from", filters.startDate ?? exportWindow.from);
    params.set("to", filters.endDate ?? exportWindow.to);
    params.set("format", "json");

    const data = normalizeExport(
      await apiClient.get<unknown>(
        `/api/v1/audit/export/download?${params.toString()}`,
      ),
    );
    const records = data.records.filter((record) =>
      recordMatchesFilters(record, filters),
    );
    const exportData = {
      ...data,
      records,
      totalRecords: records.length,
    };
    const payload =
      format === "json"
        ? JSON.stringify(exportData, null, 2)
        : auditExportToCsv(records);

    downloadAuditExport(payload, format);
    toast.success("Audit log exported");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Audit export failed";
    toast.error("Export failed", { description: message });
  }
}
