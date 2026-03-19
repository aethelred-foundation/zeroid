/**
 * useAudit — Hook for audit trail queries.
 *
 * Provides read-only access to identity, credential, and verification
 * audit logs with filtering, pagination, and export support.
 */

import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import type {
  AuditLogEntry,
  AuditFilter,
  CredentialAuditEntry,
  VerificationAuditEntry,
  AuditExport,
} from "@/types";

// ---------------------------------------------------------------------------
// Convenience wrapper — used by pages that need { auditLog }
// ---------------------------------------------------------------------------

export function useAudit() {
  const result = useAuditLog();
  return {
    auditLog: result.data?.entries ?? [],
    total: result.data?.total ?? 0,
    isLoading: result.isLoading,
  };
}

// ---------------------------------------------------------------------------
// General audit log
// ---------------------------------------------------------------------------

export function useAuditLog(filters: AuditFilter = {}) {
  const { address } = useAccount();

  const params = new URLSearchParams();
  if (filters.action) params.set("action", filters.action);
  if (filters.entityType) params.set("entityType", filters.entityType);
  if (filters.entityId) params.set("entityId", filters.entityId);
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  params.set("page", String(filters.page ?? 1));
  params.set("pageSize", String(filters.pageSize ?? 50));

  return useQuery({
    queryKey: ["auditLog", address, filters],
    queryFn: () =>
      apiClient.get<{ entries: AuditLogEntry[]; total: number }>(
        `/v1/audit/${address}/log?${params.toString()}`,
      ),
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
    queryFn: () =>
      apiClient.get<CredentialAuditEntry[]>(
        `/v1/audit/credential/${credentialId}`,
      ),
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
    queryFn: () =>
      apiClient.get<VerificationAuditEntry[]>(
        `/v1/audit/verification/${verificationId}`,
      ),
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
    queryFn: () =>
      apiClient.get<{
        totalActions: number;
        credentialsIssued: number;
        credentialsRevoked: number;
        verificationsCompleted: number;
        verificationsReceived: number;
        disclosuresMade: number;
        lastActivity: string;
      }>(`/v1/audit/${address}/summary`),
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
    const params = new URLSearchParams();
    if (filters.action) params.set("action", filters.action);
    if (filters.entityType) params.set("entityType", filters.entityType);
    if (filters.startDate) params.set("startDate", filters.startDate);
    if (filters.endDate) params.set("endDate", filters.endDate);
    params.set("format", format);

    const data = await apiClient.get<AuditExport>(
      `/v1/audit/${address}/export?${params.toString()}`,
    );

    const blob = new Blob(
      [
        format === "json"
          ? JSON.stringify(data, null, 2)
          : (data as unknown as string),
      ],
      { type: format === "json" ? "application/json" : "text/csv" },
    );

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
