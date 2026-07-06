import { NextRequest } from "next/server";
import {
  BackendProxyConfigError,
  apiJson,
  buildBackendHeaders,
  buildBackendFetchSignal,
  getBackendApiBaseUrl,
  isBackendFetchTimeout,
  JsonBodyReadError,
  readBackendError,
  readJsonObjectBody,
  requireAuthorization,
} from "../../_lib/backend";

const MAX_CREDENTIAL_ID_LENGTH = 128;
const MAX_ATTRIBUTE_NAME_LENGTH = 128;
const MAX_PROOF_STRING_LENGTH = 200_000;

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonObjectBody(request);
    if (!body) {
      return apiJson(
        { error: "Request body must be a JSON object" },
        { status: 400 },
      );
    }

    const credentialId = readOptionalBoundedString(
      body.credentialId ?? body.credentialHash,
      MAX_CREDENTIAL_ID_LENGTH,
    );
    const proof = readProofPayload(body.proof);
    const attributeName =
      body.attributeName === undefined
        ? undefined
        : readOptionalBoundedString(body.attributeName, MAX_ATTRIBUTE_NAME_LENGTH);

    if (!credentialId || !proof) {
      return apiJson(
        { error: "Missing credentialId or proof" },
        { status: 400 },
      );
    }

    if (body.attributeName !== undefined && !attributeName) {
      return apiJson(
        { error: "attributeName must be a bounded string" },
        { status: 400 },
      );
    }

    const authorization = requireAuthorization(request);
    if (!authorization) {
      return apiJson(
        { error: "Authorization bearer token required" },
        { status: 401 },
      );
    }

    const apiUrl = getBackendApiBaseUrl();
    const encodedCredentialId = encodeURIComponent(String(credentialId));
    const response = await fetch(
      `${apiUrl}/api/v1/credentials/${encodedCredentialId}/verify`,
      {
        method: "POST",
        headers: buildBackendHeaders(request, authorization),
        redirect: "manual",
        signal: buildBackendFetchSignal(),
        body: JSON.stringify({ proof, attributeName }),
      },
    );

    if (!response.ok) {
      return apiJson(
        { error: await readBackendError(response, "Verification failed") },
        { status: response.status },
      );
    }

    const result = await response.json();
    return apiJson(result);
  } catch (error) {
    if (error instanceof BackendProxyConfigError) {
      return apiJson({ error: error.message }, { status: 503 });
    }
    if (error instanceof JsonBodyReadError) {
      return apiJson(
        { error: error.message },
        { status: error.statusCode },
      );
    }
    if (isBackendFetchTimeout(error)) {
      return apiJson(
        { error: "Backend request timed out" },
        { status: 504 },
      );
    }

    return apiJson(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

function readOptionalBoundedString(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return undefined;
  return trimmed;
}

function readProofPayload(value: unknown): string | Record<string, unknown> | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_PROOF_STRING_LENGTH) {
      return undefined;
    }
    return trimmed;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}
