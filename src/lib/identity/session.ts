import { clearIdentityAuthToken } from "@/lib/identity/registration";

export const IDENTITY_SESSION_EXPIRED_EVENT = "zeroid:identity-session-expired";

export interface IdentitySessionExpiredDetail {
  reason: string;
}

/**
 * Invalidate the in-memory identity session and notify mounted providers.
 *
 * Bearer tokens are deliberately not persisted in production. Keeping this
 * notification browser-local lets every authenticated API surface fail closed
 * without coupling the HTTP client to React.
 */
export function expireIdentitySession(
  reason = "Your ZeroID session expired. Sign in again to continue.",
): void {
  clearIdentityAuthToken();

  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<IdentitySessionExpiredDetail>(
      IDENTITY_SESSION_EXPIRED_EVENT,
      { detail: { reason } },
    ),
  );
}
