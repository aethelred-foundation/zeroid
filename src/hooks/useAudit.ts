/**
 * useAudit — Hook for audit trail queries.
 *
 * Provides read-only access to identity, credential, and verification
 * audit logs with filtering, pagination, and export support.
 */

import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient, ZeroIDApiError } from "@/lib/api/client";
import type {
  AuditLogEntry,
  AuditFilter,
  CredentialAuditEntry,
  VerificationAuditEntry,
  AuditExport,
} from "@/types";

type BackendAuditLogEntry = AuditLogEntry & {
  resourceType?: string;
  resourceId?: string;
  identityId?: string;
};

type BackendAuditSummary = {
  totalEvents?: number;
  eventsLast30Days?: number;
  actionBreakdown?: Array<{ action: string; count: number }>;
  lastActivity?: {
    action?: string;
    resourceType?: string;
    timestamp?: string;
  } | null;
};

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

function toAuditLogEntry(entry: BackendAuditLogEntry): AuditLogEntry {
  return {
    ...entry,
    type: entry.type ?? entry.action ?? "audit",
    actor: entry.actor ?? entry.identityId,
    entityType: entry.entityType ?? entry.resourceType,
    entityId: entry.entityId ?? entry.resourceId,
  };
}

function countActions(summary: BackendAuditSummary, actions: string[]): number {
  const actionSet = new Set(actions.map((action) => action.toUpperCase()));
  return (
    summary.actionBreakdown
      ?.filter((entry) => actionSet.has(entry.action.toUpperCase()))
      .reduce((total, entry) => total + entry.count, 0) ?? 0
  );
}

function defaultExportWindow(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 3600_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

// ---------------------------------------------------------------------------
// Convenience wrapper — used by pages that need { auditLog }
// ---------------------------------------------------------------------------

export function useAudit(did?: string, limit = 50) {
  const result = useAuditLog({
    entityId: did,
    pageSize: limit,
  });
  return {
    auditLog: result.data?.entries ?? [],
    events: result.data?.entries ?? [],
    total: result.data?.total ?? 0,
    isLoading: result.isLoading,
    error: result.error,
  };
}

// ---------------------------------------------------------------------------
// General audit log
// ---------------------------------------------------------------------------

export function useAuditLog(filters: AuditFilter = {}) {
  const { address } = useAccount();

  const params = new URLSearchParams();
  appendAuditFilters(params, filters);

  return useQuery({
    queryKey: ["auditLog", address, filters],
    queryFn: async () => {
      const entries = await apiClient.get<BackendAuditLogEntry[]>(
        `/api/v1/audit?${params.toString()}`,
      );
      return {
        entries: entries.map(toAuditLogEntry),
        total: entries.length,
      };
    },
    enabled: !!address,
    staleTime: 20_000,
  });
}

// ---------------------------------------------------------------------------
// Credential-specific audit trail
// ---------------------------------------------------------------------------

export function useCredentialAudit(credentialId: string | undefined) {
  return useQuery({
    queryKey: ["credentialAudit", credentialId],
    queryFn: async () => {
      const entries = await apiClient.get<BackendAuditLogEntry[]>(
        `/api/v1/audit/resource/credential/${credentialId}?page=1&limit=100`,
      );
      return entries.map(toAuditLogEntry) as CredentialAuditEntry[];
    },
    enabled: !!credentialId,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Verification-specific audit trail
// ---------------------------------------------------------------------------

export function useVerificationAudit(verificationId: string | undefined) {
  return useQuery({
    queryKey: ["verificationAudit", verificationId],
    queryFn: async () => {
      const entries = await apiClient.get<BackendAuditLogEntry[]>(
        `/api/v1/audit/resource/verification/${verificationId}?page=1&limit=100`,
      );
      return entries.map(toAuditLogEntry) as VerificationAuditEntry[];
    },
    enabled: !!verificationId,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Identity activity summary (dashboard widget data)
// ---------------------------------------------------------------------------

export function useIdentityActivitySummary() {
  const { address } = useAccount();

  return useQuery({
    queryKey: ["identityActivity", address],
    queryFn: async () => {
      const summary = await apiClient.get<BackendAuditSummary>(
        "/api/v1/audit/summary/stats",
      );
      return {
        totalActions: summary.totalEvents ?? 0,
        credentialsIssued: countActions(summary, ["CREDENTIAL_ISSUED"]),
        credentialsRevoked: countActions(summary, ["CREDENTIAL_REVOKED"]),
        verificationsCompleted: countActions(summary, [
          "ZK_PROOF_VERIFIED",
          "TEE_ATTESTATION_VERIFIED",
          "VERIFICATION_COMPLETED",
        ]),
        verificationsReceived: countActions(summary, [
          "VERIFICATION_REQUESTED",
        ]),
        disclosuresMade: countActions(summary, ["DISCLOSURE_COMPLETED"]),
        lastActivity: summary.lastActivity?.timestamp ?? "",
      };
    },
    enabled: !!address,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Export audit data (for compliance / reporting)
// ---------------------------------------------------------------------------

export async function exportAuditLog(
  address: string,
  filters: AuditFilter = {},
  format: "json" | "csv" = "json",
): Promise<void> {
  try {
    if (format !== "json") {
      throw new ZeroIDApiError(
        "Audit CSV export is not exposed by the backend API.",
        "AUDIT_CSV_EXPORT_UNAVAILABLE",
        501,
      );
    }
    if (filters.action || filters.entityType || filters.entityId) {
      throw new ZeroIDApiError(
        "Filtered audit export by action or resource is not exposed by the backend API.",
        "AUDIT_FILTERED_EXPORT_UNAVAILABLE",
        501,
      );
    }

    const params = new URLSearchParams();
    const exportWindow = defaultExportWindow();
    params.set("from", filters.startDate ?? exportWindow.from);
    params.set("to", filters.endDate ?? exportWindow.to);
    params.set("format", "json");

    const data = await apiClient.get<AuditExport>(
      `/api/v1/audit/export/download?${params.toString()}`,
    );

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `zeroid-audit-${Date.now()}.${format}`;
    link.click();
    URL.revokeObjectURL(url);

    toast.success("Audit log exported");
  } catch (err: any) {
    toast.error("Export failed", { description: err.message });
  }
}
