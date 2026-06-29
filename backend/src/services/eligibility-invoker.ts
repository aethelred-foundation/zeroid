/**
 * ZeroID — in-process eligibility invoker.
 *
 * Reuses the human `eligibilityProofHandler` (extracted from the verification
 * route) via a response shim, so internal callers (AI Agent Passport, partner
 * integrations) get the EXACT human eligibility decision without duplicating
 * logic or making an HTTP round-trip.
 */

import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import { eligibilityProofHandler } from '../routes/verification';
import type { EligibilityResult } from './ai/agent-eligibility';

export class EligibilityInvocationError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = 'EligibilityInvocationError';
  }
}

export interface EligibilityInvokeInput {
  subjectDid: string;
  credentialId: string;
  policyId: string;
  relyingAppId: string;
  contextNonce?: string;
}

export async function invokeEligibility(
  identity: { id: string; did: string },
  input: EligibilityInvokeInput,
): Promise<EligibilityResult> {
  const fakeReq = {
    identity,
    body: {
      subjectDid: input.subjectDid,
      credentialId: input.credentialId,
      policyId: input.policyId,
      relyingAppId: input.relyingAppId,
      contextNonce:
        input.contextNonce ??
        `partner-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
    },
  } as unknown as AuthenticatedRequest;

  let httpStatus = 200;
  let payload:
    | { data?: EligibilityResult; error?: string; code?: string }
    | undefined;
  const fakeRes = {
    status(code: number) {
      httpStatus = code;
      return fakeRes;
    },
    json(value: unknown) {
      payload = value as typeof payload;
      return fakeRes;
    },
  } as unknown as Response;

  await eligibilityProofHandler(fakeReq, fakeRes);

  if (httpStatus !== 201 || !payload?.data) {
    throw new EligibilityInvocationError(
      payload?.error ?? 'eligibility evaluation failed',
      payload?.code ?? 'ELIGIBILITY_FAILED',
      httpStatus >= 400 ? httpStatus : 502,
    );
  }
  return payload.data;
}
