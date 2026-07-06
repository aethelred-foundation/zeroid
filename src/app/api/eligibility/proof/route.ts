import { NextRequest, type NextResponse } from 'next/server';
import {
  EligibilityProofContractError,
  ZEROID_ELIGIBILITY_POLICY_V1,
  ZEROID_SAMPLE_KYC_CREDENTIAL,
  evaluateEligibilityProof,
  type EligibilityProofRequest,
} from '@/lib/eligibility/kycCredential';
import {
  BackendProxyConfigError,
  apiJson,
  buildBackendFetchSignal,
  buildBackendHeaders,
  getBackendApiBaseUrl,
  isBackendFetchTimeout,
  JsonBodyReadError,
  isProductionRuntime,
  readBackendError,
  readJsonObjectBody,
  requireAuthorization,
} from '../../_lib/backend';
import { validateBackendEligibilityResult } from '../_lib/contract';

const MAX_SUBJECT_DID_LENGTH = 256;
const MAX_CREDENTIAL_ID_LENGTH = 128;
const MAX_POLICY_ID_LENGTH = 256;
const MAX_RELYING_APP_ID_LENGTH = 128;
const MIN_CONTEXT_NONCE_LENGTH = 8;
const MAX_CONTEXT_NONCE_LENGTH = 128;
const USE_BACKEND_HEADER = 'x-zeroid-use-backend';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonObjectBody(request);
    if (!body) {
      return apiJson(
        {
          error: 'Request body must be a JSON object',
          code: 'ELIGIBILITY_REQUEST_INVALID',
        },
        { status: 400 },
      );
    }

    const parsed = parseEligibilityRequest(body);
    if (!parsed.ok) {
      return apiJson(
        {
          error: 'Invalid eligibility proof request',
          code: 'ELIGIBILITY_REQUEST_INVALID',
          details: { missing: parsed.missing },
        },
        { status: 400 },
      );
    }

    const authorization = requireAuthorization(request);
    const useBackend = request.headers.get(USE_BACKEND_HEADER) === 'true';
    if (useBackend) {
      if (!authorization) {
        return apiJson(
          {
            error: 'Authorization bearer token required for backend mode',
            code: 'ELIGIBILITY_BACKEND_AUTH_REQUIRED',
          },
          { status: 401 },
        );
      }
      return await proxyEligibilityProofToBackend(
        request,
        parsed.request,
        authorization,
      );
    }

    if (isProductionRuntime()) {
      return apiJson(
        {
          error:
            'Eligibility proof requests must use the authenticated backend in production',
          code: 'ELIGIBILITY_BACKEND_REQUIRED',
        },
        { status: 503 },
      );
    }

    const result = await evaluateEligibilityProof(
      parsed.request,
      ZEROID_SAMPLE_KYC_CREDENTIAL,
      ZEROID_ELIGIBILITY_POLICY_V1,
    );

    return apiJson({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof EligibilityProofContractError) {
      return apiJson(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: error.statusCode },
      );
    }

    if (error instanceof JsonBodyReadError) {
      return apiJson(
        {
          error: error.message,
          code: 'ELIGIBILITY_REQUEST_INVALID',
        },
        { status: error.statusCode },
      );
    }
    if (error instanceof BackendProxyConfigError) {
      return apiJson(
        {
          error: error.message,
          code: 'ELIGIBILITY_BACKEND_UNAVAILABLE',
        },
        { status: 503 },
      );
    }
    if (isBackendFetchTimeout(error)) {
      return apiJson(
        {
          error: 'Backend request timed out',
          code: 'ELIGIBILITY_BACKEND_TIMEOUT',
        },
        { status: 504 },
      );
    }

    return apiJson(
      {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      },
      { status: 500 },
    );
  }
}

function parseEligibilityRequest(
  body: Record<string, unknown>,
):
  | { ok: true; request: EligibilityProofRequest }
  | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const subjectDid = readBoundedString(
    body,
    'subjectDid',
    1,
    MAX_SUBJECT_DID_LENGTH,
    missing,
  );
  const credentialId = readBoundedString(
    body,
    'credentialId',
    1,
    MAX_CREDENTIAL_ID_LENGTH,
    missing,
  );
  const policyId = readBoundedString(
    body,
    'policyId',
    1,
    MAX_POLICY_ID_LENGTH,
    missing,
  );
  const relyingAppId = readBoundedString(
    body,
    'relyingAppId',
    1,
    MAX_RELYING_APP_ID_LENGTH,
    missing,
  );
  const contextNonce = readBoundedString(
    body,
    'contextNonce',
    MIN_CONTEXT_NONCE_LENGTH,
    MAX_CONTEXT_NONCE_LENGTH,
    missing,
  );

  if (missing.length > 0) {
    return { ok: false, missing };
  }

  const options =
    body.options &&
    typeof body.options === 'object' &&
    !Array.isArray(body.options)
      ? (body.options as Record<string, unknown>)
      : {};

  if (
    body.options !== undefined &&
    (!body.options ||
      typeof body.options !== 'object' ||
      Array.isArray(body.options))
  ) {
    return { ok: false, missing: ['options:object'] };
  }

  const optionViolations = [
    'requireOnchainAttestation',
    'requireNonRevocationProof',
    'dryRun',
  ].filter((field) => {
    const value = options[field];
    return value !== undefined && typeof value !== 'boolean';
  });

  if (optionViolations.length > 0) {
    return {
      ok: false,
      missing: optionViolations.map((field) => `options.${field}:boolean`),
    };
  }

  return {
    ok: true,
    request: {
      subjectDid,
      credentialId,
      policyId,
      relyingAppId,
      contextNonce,
      options: {
        requireOnchainAttestation: options.requireOnchainAttestation === true,
        requireNonRevocationProof: options.requireNonRevocationProof !== false,
        dryRun: options.dryRun !== false,
      },
    },
  };
}

function readBoundedString(
  body: Record<string, unknown>,
  field: string,
  minLength: number,
  maxLength: number,
  violations: string[],
): string {
  const value = body[field];
  if (typeof value !== 'string') {
    violations.push(field);
    return '';
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    violations.push(field);
  } else if (trimmed.length < minLength) {
    violations.push(`${field}:minLength`);
  } else if (trimmed.length > maxLength) {
    violations.push(`${field}:maxLength`);
  }

  return trimmed;
}

async function proxyEligibilityProofToBackend(
  request: Request,
  payload: EligibilityProofRequest,
  authorization: string,
): Promise<NextResponse> {
  const apiUrl = getBackendApiBaseUrl();
  const response = await fetch(
    `${apiUrl}/api/v1/verification/eligibility-proof`,
    {
      method: 'POST',
      headers: buildBackendHeaders(request, authorization),
      redirect: 'manual',
      signal: buildBackendFetchSignal(),
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    return apiJson(
      {
        error: await readBackendError(
          response,
          'Backend eligibility proof failed',
        ),
        code: 'ELIGIBILITY_BACKEND_ERROR',
      },
      { status: response.status },
    );
  }

  const result = await response.json();
  const contractViolations = validateBackendEligibilityResult(result);
  if (contractViolations.length > 0) {
    return apiJson(
      {
        error: 'Backend eligibility proof response failed contract validation',
        code: 'ELIGIBILITY_BACKEND_CONTRACT_INVALID',
        details: { violations: contractViolations },
      },
      { status: 502 },
    );
  }

  return apiJson(
    {
      success: true,
      ...result,
      source: 'backend',
      timestamp: new Date().toISOString(),
    },
    { status: response.status },
  );
}
