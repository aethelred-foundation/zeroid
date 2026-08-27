/**
 * ZeroID — in-process eligibility invoker.
 *
 * Reuses the human `eligibilityProofHandler` only to propagate its authoritative
 * fail-closed availability/error status. Partner integrations cannot consume a
 * successful decision until they issue and atomically consume a durable,
 * one-time relying-party challenge. This adapter therefore rejects even an
 * accidental upstream success instead of silently treating a locally generated
 * nonce as relying-party authorization.
 */

import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedRequest } from '../middleware/auth';
import { eligibilityProofHandler } from '../routes/verification';

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
): Promise<never> {
  if (identity.did !== input.subjectDid) {
    throw new EligibilityInvocationError(
      'authenticated identity does not match eligibility subject',
      'CREDENTIAL_SUBJECT_MISMATCH',
      403,
    );
  }

  const fakeReq = {
    identity,
    body: {
      subjectDid: input.subjectDid,
      credentialId: input.credentialId,
      policyId: input.policyId,
      relyingAppId: input.relyingAppId,
      contextNonce: input.contextNonce ?? `partner-${randomUUID()}`,
    },
  } as unknown as AuthenticatedRequest;

  let httpStatus = 200;
  let payload: { data?: unknown; error?: string; code?: string } | undefined;
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

  if (httpStatus === 201 && payload?.data) {
    throw new EligibilityInvocationError(
      'Partner eligibility is unavailable until a durable one-time relying-party challenge is issued, bound to the proof context, and consumed atomically with verified evidence',
      'PARTNER_ELIGIBILITY_CHALLENGE_UNAVAILABLE',
      503,
    );
  }

  throw new EligibilityInvocationError(
    payload?.error ?? 'eligibility evaluation failed',
    payload?.code ?? 'ELIGIBILITY_FAILED',
    httpStatus >= 400 ? httpStatus : 502,
  );
}
