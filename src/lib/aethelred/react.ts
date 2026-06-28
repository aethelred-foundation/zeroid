"use client";

/**
 * ZeroID — Aethelred Conformance Boundary: canonical React hooks
 *
 * Thin wrappers over the SDK's client-parametrized hooks that inject the
 * boundary client, so ZeroID components consume canonical chain hooks
 * (seal fetch/verify, job status) without managing the client themselves.
 * ZeroID's own backend-domain hooks (credentials/identity) are unaffected.
 */

import {
  useSeal as useSdkSeal,
  useSealVerification as useSdkSealVerification,
  useJob as useSdkJob,
  useAethelredQuery,
} from "@aethelred/sdk/react";
import { getAethelredClient } from "./client";

/** Fetch a Digital Seal by id on the canonical chain. */
export function useSeal(
  sealId: string | null | undefined,
  options?: Parameters<typeof useSdkSeal>[2],
) {
  return useSdkSeal(getAethelredClient(), sealId, options);
}

/** Verify a Digital Seal by id on the canonical chain. */
export function useSealVerification(
  sealId: string | null | undefined,
  options?: Parameters<typeof useSdkSealVerification>[2],
) {
  return useSdkSealVerification(getAethelredClient(), sealId, options);
}

/** Poll a PoUW job by id on the canonical chain. */
export function useJob(
  jobId: string | null | undefined,
  options?: Parameters<typeof useSdkJob>[2],
) {
  return useSdkJob(getAethelredClient(), jobId, options);
}

export { useAethelredQuery };
