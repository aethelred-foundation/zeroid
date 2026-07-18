"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  XCircle,
  Search,
  AlertTriangle,
  Shield,
  ShieldCheck,
  RefreshCw,
  Ban,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useCredentials, useRevokeCredential } from "@/hooks/useCredentials";
import { Modal } from "@/components/ui/Modal";
import { toast } from "sonner";

export default function RevocationPage() {
  // Revocation is an issuer authority. Holder inventory surfaces never expose
  // this action, and this page explicitly queries credentials issued by the
  // authenticated identity.
  const credentialsQuery = useCredentials(undefined, "issuer");
  const credentials = credentialsQuery.data?.credentials ?? [];
  const revokeCredentialMutation = useRevokeCredential();
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [revocationReason, setRevocationReason] = useState("");
  const [revoking, setRevoking] = useState(false);

  const activeCredentials = credentials.filter(
    (credential) =>
      credential.status === "active" &&
      (!searchQuery ||
        credential.typeLabel.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  const revokedCredentials = credentials.filter(
    (credential) => credential.status === "revoked",
  );

  const handleRevoke = async (credentialId: string) => {
    const reason = revocationReason.trim();
    if (reason.length < 5) {
      toast.error("Enter a revocation reason of at least 5 characters");
      return;
    }

    setRevoking(true);
    try {
      await revokeCredentialMutation.mutateAsync({ credentialId, reason });
      setConfirmRevoke(null);
      setRevocationReason("");
    } catch {
      // The mutation owns the actionable error toast so callers do not emit
      // duplicate failure notifications.
    } finally {
      setRevoking(false);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Revocation</h1>
          <p className="text-[var(--text-secondary)] mt-1">
            Manage credentials issued by your authenticated issuer identity
          </p>
        </div>

        {/* Warning */}
        <div className="p-4 bg-status-pending/5 border border-status-pending/20 rounded-xl">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-status-pending shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-medium">
                Issuer-only registry revocation
              </div>
              <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                This records a permanent revocation in the ZeroID registry and
                audit log. It does not claim an on-chain transaction.
              </div>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
          <input
            type="text"
            placeholder="Search credentials issued by you..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input pl-10"
          />
        </div>

        {/* Active Credentials */}
        <div>
          <h2 className="text-lg font-semibold mb-3">
            Active Credentials ({activeCredentials.length})
          </h2>
          {activeCredentials.length > 0 ? (
            <div className="space-y-3">
              {activeCredentials.map((cred) => (
                <div
                  key={cred.id}
                  className="card p-4 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-status-verified/10 flex items-center justify-center">
                      <ShieldCheck className="w-5 h-5 text-status-verified" />
                    </div>
                    <div>
                      <div className="font-medium text-sm">
                        {cred.typeLabel}
                      </div>
                      <div className="text-xs text-[var(--text-tertiary)]">
                        Issued {new Date(cred.issuedAt).toLocaleDateString()} ·{" "}
                        {cred.expiresAt
                          ? `Expires ${new Date(cred.expiresAt).toLocaleDateString()}`
                          : "No expiry"}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setConfirmRevoke(cred.id)}
                    className="btn-ghost btn-sm text-status-revoked hover:bg-status-revoked/10"
                  >
                    <Ban className="w-4 h-4" />
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="card p-8 text-center">
              <Shield className="w-10 h-10 mx-auto mb-2 text-[var(--text-tertiary)]" />
              <p className="text-sm text-[var(--text-secondary)]">
                No active credentials to revoke
              </p>
            </div>
          )}
        </div>

        {/* Revoked Credentials */}
        {revokedCredentials.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">
              Previously Revoked ({revokedCredentials.length})
            </h2>
            <div className="space-y-2">
              {revokedCredentials.map((cred) => (
                <div
                  key={cred.id}
                  className="card p-4 flex items-center justify-between opacity-60"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-status-revoked/10 flex items-center justify-center">
                      <XCircle className="w-5 h-5 text-status-revoked" />
                    </div>
                    <div>
                      <div className="font-medium text-sm line-through">
                        {cred.typeLabel}
                      </div>
                      <div className="text-xs text-[var(--text-tertiary)]">
                        Revocation recorded in the ZeroID registry
                      </div>
                    </div>
                  </div>
                  <StatusBadge status="revoked" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Confirm Revocation Modal */}
      <Modal
        open={!!confirmRevoke}
        onClose={() => {
          setConfirmRevoke(null);
          setRevocationReason("");
        }}
        title="Confirm Revocation"
        size="sm"
      >
        <div className="space-y-4">
          <div className="p-4 bg-status-revoked/5 border border-status-revoked/20 rounded-xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-status-revoked shrink-0" />
              <div className="text-sm text-[var(--text-secondary)]">
                This will mark the credential revoked in the ZeroID registry.
                Only the issuing identity is authorized to perform this action.
              </div>
            </div>
          </div>
          <label className="block space-y-2 text-sm">
            <span className="font-medium">Revocation reason</span>
            <textarea
              value={revocationReason}
              onChange={(event) => setRevocationReason(event.target.value)}
              className="input min-h-24"
              maxLength={500}
              placeholder="Explain why this credential is no longer valid"
            />
          </label>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => {
                setConfirmRevoke(null);
                setRevocationReason("");
              }}
              className="btn-secondary"
              disabled={revoking}
            >
              Cancel
            </button>
            <button
              onClick={() => confirmRevoke && handleRevoke(confirmRevoke)}
              className="btn-danger"
              disabled={revoking || revocationReason.trim().length < 5}
            >
              {revoking ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Revoking...
                </>
              ) : (
                <>
                  <Ban className="w-4 h-4" />
                  Confirm Revoke
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
