/**
 * useTEE — Trusted Execution Environment node status and attestation checks.
 */

import { useState, useCallback, useEffect } from "react";
import { apiClient } from "@/lib/api/client";
import { getPlatformLabel, selectBestNode } from "@/lib/tee/attestation";
import { isExpired } from "@/lib/utils";
import type { AttestationInfo, TEENode, TEENodeStatus } from "@/types";

interface TEEState {
  nodes: TEENodeStatus[];
  attestation: AttestationInfo | null;
  isLoading: boolean;
  error: string | null;
}

function statusFromNode(node: TEENode): TEENodeStatus["status"] {
  if (!node.isOnline) return "offline";
  if (!node.attestation.isValid || isExpired(node.attestation.expiresAt)) {
    return "degraded";
  }
  if (node.uptimePercent < 95 || node.avgLatencyMs > 5_000) {
    return "degraded";
  }
  return "active";
}

function nodeToStatus(node: TEENode): TEENodeStatus {
  const status = statusFromNode(node);
  return {
    id: node.id,
    type: getPlatformLabel(node.platform),
    status,
    health:
      status === "active"
        ? "healthy"
        : status === "offline"
          ? "offline"
          : "degraded",
    uptime: node.uptimePercent,
    region: node.region,
    name: node.name,
    lastSeen: new Date().toISOString(),
  };
}

function nodeToAttestationInfo(node: TEENode): AttestationInfo {
  const expired = isExpired(node.attestation.expiresAt);
  return {
    valid: node.attestation.isValid && !expired,
    lastVerified: new Date(node.attestation.attestedAt * 1000).toISOString(),
    expiresAt: new Date(node.attestation.expiresAt * 1000).toISOString(),
    enclaveHash: node.attestation.enclaveHash,
    status: expired
      ? "expired"
      : node.attestation.isValid
        ? "verified"
        : "invalid",
    enclaveId: node.attestation.enclaveHash,
  };
}

export function useTEE() {
  const [state, setState] = useState<TEEState>({
    nodes: [],
    attestation: null,
    isLoading: false,
    error: null,
  });

  const refreshStatus = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const nodes = await apiClient.listTEENodes();
      const bestNode = selectBestNode(nodes);
      setState({
        nodes: nodes.map(nodeToStatus),
        attestation: bestNode ? nodeToAttestationInfo(bestNode) : null,
        isLoading: false,
        error: null,
      });
      return nodes;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load TEE status";
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: message,
      }));
      throw err;
    }
  }, []);

  useEffect(() => {
    refreshStatus().catch(() => undefined);
  }, [refreshStatus]);

  const enclaveStatus =
    state.nodes.length === 0
      ? "offline"
      : state.nodes.every((node) => node.status === "active")
        ? "healthy"
        : state.nodes.some((node) => node.status === "active")
          ? "degraded"
          : "offline";

  return {
    nodes: state.nodes,
    attestation: state.attestation,
    isLoading: state.isLoading,
    error: state.error,
    refreshStatus,
    enclaveStatus,
  };
}
