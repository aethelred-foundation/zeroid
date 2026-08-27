"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ShieldCheck,
} from "lucide-react";

import { useUAEPass } from "@/hooks/useUAEPass";

type CallbackStatus = "missing_context" | "pending" | "verified" | "failed";

function readCallbackParams(): { code?: string; state?: string } {
  if (typeof window === "undefined") {
    return {};
  }

  const params = new URLSearchParams(window.location.search);
  return {
    code: params.get("code") ?? undefined,
    state: params.get("state") ?? undefined,
  };
}

export default function UAEPassCallbackPage() {
  const completionStarted = useRef(false);
  const { completeVerification, verificationStatus, verification, error } =
    useUAEPass();

  const callback = useMemo(readCallbackParams, []);
  const hasCallbackContext = Boolean(callback.code && callback.state);

  useEffect(() => {
    if (!hasCallbackContext || completionStarted.current) {
      return;
    }

    completionStarted.current = true;
    void completeVerification({
      code: callback.code,
      state: callback.state!,
    });
  }, [callback.code, callback.state, completeVerification, hasCallbackContext]);

  const status: CallbackStatus = !hasCallbackContext
    ? "missing_context"
    : verificationStatus === "verified"
      ? "verified"
      : verificationStatus === "failed"
        ? "failed"
        : "pending";

  return (
    <main className="min-h-screen bg-[var(--surface-primary)] text-[var(--text-primary)]">
      <section className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-6 py-16">
        <div className="w-full rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-secondary)] p-8 shadow-soft">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/10">
              <ShieldCheck className="h-6 w-6 text-brand-500" />
            </div>
            <div>
              <p className="text-sm uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                UAE Pass Callback
              </p>
              <h1 className="text-2xl font-semibold">
                Government Verification
              </h1>
            </div>
          </div>

          {status === "pending" && (
            <div className="flex items-start gap-4">
              <Loader2 className="mt-1 h-6 w-6 animate-spin text-status-pending" />
              <div>
                <h2 className="text-lg font-semibold">
                  Completing backend verification
                </h2>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  ZeroID is validating the UAE Pass callback, consuming the
                  OAuth state, and recording government verification evidence.
                </p>
              </div>
            </div>
          )}

          {status === "verified" && (
            <div className="flex items-start gap-4">
              <CheckCircle2 className="mt-1 h-6 w-6 text-status-verified" />
              <div>
                <h2 className="text-lg font-semibold">
                  Government verification complete
                </h2>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  Provider {verification?.provider ?? "UAE_PASS"} confirmed the
                  identity. Reference {verification?.referenceId ?? "recorded"}{" "}
                  is now bound to the ZeroID identity profile.
                </p>
              </div>
            </div>
          )}

          {status === "failed" && (
            <div className="flex items-start gap-4">
              <AlertTriangle className="mt-1 h-6 w-6 text-red-400" />
              <div>
                <h2 className="text-lg font-semibold">
                  Verification could not be completed
                </h2>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  {error ??
                    "The UAE Pass callback could not be validated. Restart the verification flow from your ZeroID identity screen."}
                </p>
              </div>
            </div>
          )}

          {status === "missing_context" && (
            <div className="flex items-start gap-4">
              <AlertTriangle className="mt-1 h-6 w-6 text-red-400" />
              <div>
                <h2 className="text-lg font-semibold">
                  Callback context missing
                </h2>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  UAE Pass did not return the authorization code and state
                  required to complete verification.
                </p>
              </div>
            </div>
          )}

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/identity" className="btn-primary">
              Return to Identity
            </Link>
            <Link href="/" className="btn-secondary">
              Open Dashboard
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
