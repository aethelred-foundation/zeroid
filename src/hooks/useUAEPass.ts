/**
 * useUAEPass — Backend-backed UAE Pass identity verification.
 */

import { useCallback, useState } from "react";

import {
  apiClient,
  type GovernmentVerificationResult,
  type UAEPassAuthorizationStart,
} from "@/lib/api/client";
import { getIdentityAuthToken } from "@/lib/identity/registration";

type VerificationStatus = "idle" | "pending" | "verified" | "failed";

interface StartVerificationOptions {
  authToken?: string;
  redirectUri?: string;
  openRedirect?: boolean;
}

interface CompleteVerificationOptions {
  authToken?: string;
  authorizationCode?: string;
  code?: string;
  state: string;
}

const UAE_PASS_CALLBACK_PATH = "/identity/uae-pass/callback";

function resolveRedirectUri(redirectUri?: string): string {
  if (redirectUri) return redirectUri;
  if (typeof window === "undefined") {
    throw new Error("UAE Pass redirect URI is required outside the browser.");
  }
  return new URL(UAE_PASS_CALLBACK_PATH, window.location.origin).toString();
}

function normalizeSafeAuthorizationUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("UAE Pass authorization URL was rejected.");
  }

  const isLocalHttp =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new Error("UAE Pass authorization URL was rejected.");
  }
  if (url.username || url.password || url.hash) {
    throw new Error("UAE Pass authorization URL was rejected.");
  }

  return url.toString();
}

function resolveAuthToken(authToken?: string): string {
  const token = authToken ?? getIdentityAuthToken();
  if (!token) {
    throw new Error(
      "An authenticated ZeroID identity session is required before UAE Pass verification can start.",
    );
  }
  return token;
}

export function useUAEPass() {
  const [verificationStatus, setVerificationStatus] =
    useState<VerificationStatus>("idle");
  const [authorization, setAuthorization] =
    useState<UAEPassAuthorizationStart | null>(null);
  const [verification, setVerification] =
    useState<GovernmentVerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initiateVerification = useCallback(
    async (
      options: StartVerificationOptions = {},
    ): Promise<UAEPassAuthorizationStart> => {
      setVerificationStatus("pending");
      setError(null);

      try {
        const token = resolveAuthToken(options.authToken);
        const auth = await apiClient.startUAEPassVerification(
          resolveRedirectUri(options.redirectUri),
          token,
        );
        const safeAuthUrl = normalizeSafeAuthorizationUrl(auth.authUrl);
        setAuthorization({ ...auth, authUrl: safeAuthUrl });

        if (options.openRedirect !== false && typeof window !== "undefined") {
          window.location.assign(safeAuthUrl);
        }

        return { ...auth, authUrl: safeAuthUrl };
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "UAE Pass verification could not be started.";
        setVerificationStatus("failed");
        setError(message);
        throw err;
      }
    },
    [],
  );

  const completeVerification = useCallback(
    async (
      options: CompleteVerificationOptions,
    ): Promise<GovernmentVerificationResult> => {
      setVerificationStatus("pending");
      setError(null);

      try {
        const token = resolveAuthToken(options.authToken);
        const result = await apiClient.completeUAEPassVerification(
          {
            authorizationCode: options.authorizationCode,
            code: options.code,
            state: options.state,
          },
          token,
        );
        setVerification(result);
        setVerificationStatus(result.verified ? "verified" : "failed");
        return result;
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "UAE Pass verification failed.";
        setVerificationStatus("failed");
        setError(message);
        throw err;
      }
    },
    [],
  );

  return {
    initiateVerification,
    completeVerification,
    verificationStatus,
    authorization,
    verification,
    error,
    isVerified: verificationStatus === "verified",
  };
}
