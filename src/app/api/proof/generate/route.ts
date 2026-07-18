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
const MAX_REQUEST_ID_LENGTH = 36;
const MAX_CIRCUIT_NAME_LENGTH = 128;
const MAX_AUDIENCE_LENGTH = 256;
const MIN_NONCE_LENGTH = 8;
const MAX_NONCE_LENGTH = 128;
const MAX_INPUT_FIELDS = 64;
const MAX_INPUT_FIELD_LENGTH = 128;
const MAX_SELECTIVE_DISCLOSURE_FIELDS = 64;

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonObjectBody(request);
    if (!body) {
      return apiJson(
        { error: "Request body must be a JSON object" },
        { status: 400 },
      );
    }

    const rawInputs = body.inputs ?? body.publicInputs;
    const credentialId = readBoundedString(
      body.credentialId,
      MAX_CREDENTIAL_ID_LENGTH,
    );
    const requestId =
      body.requestId === undefined
        ? undefined
        : readBoundedString(body.requestId, MAX_REQUEST_ID_LENGTH);
    const circuitName = readBoundedString(
      body.circuitName ?? body.circuitType,
      MAX_CIRCUIT_NAME_LENGTH,
    );
    const inputs = readInputsObject(rawInputs);
    const audience = readBoundedString(body.audience, MAX_AUDIENCE_LENGTH);
    const nonce =
      body.nonce === undefined
        ? undefined
        : readBoundedString(body.nonce, MAX_NONCE_LENGTH, MIN_NONCE_LENGTH);
    const selectiveDisclosure =
      body.selectiveDisclosure === undefined
        ? undefined
        : readStringArray(
            body.selectiveDisclosure,
            MAX_SELECTIVE_DISCLOSURE_FIELDS,
            MAX_INPUT_FIELD_LENGTH,
          );

    if (!credentialId || !circuitName || rawInputs === undefined || !audience) {
      return apiJson(
        { error: "Missing credentialId, circuitName, inputs, or audience" },
        { status: 400 },
      );
    }

    if (!inputs) {
      return apiJson(
        {
          error: "Proof inputs must be an object keyed by circuit signal name",
        },
        { status: 400 },
      );
    }

    if (body.nonce !== undefined && !nonce) {
      return apiJson(
        { error: "nonce must be a bounded string" },
        { status: 400 },
      );
    }

    if (
      body.requestId !== undefined &&
      (!requestId ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          requestId,
        ))
    ) {
      return apiJson({ error: "requestId must be a UUID" }, { status: 400 });
    }

    if (body.selectiveDisclosure !== undefined && !selectiveDisclosure) {
      return apiJson(
        {
          error: "selectiveDisclosure must be an array of bounded strings",
        },
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
    const response = await fetch(`${apiUrl}/api/v1/verification/zk-proof`, {
      method: "POST",
      headers: buildBackendHeaders(request, authorization),
      redirect: "manual",
      signal: buildBackendFetchSignal(),
      body: JSON.stringify({
        credentialId,
        ...(requestId ? { requestId } : {}),
        circuitName,
        inputs,
        selectiveDisclosure,
        audience,
        nonce,
      }),
    });

    if (!response.ok) {
      return apiJson(
        { error: await readBackendError(response, "Proof generation failed") },
        { status: response.status },
      );
    }

    const proof = await response.json();
    return apiJson(proof);
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

function readBoundedString(
  value: unknown,
  maxLength: number,
  minLength = 1,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length < minLength || trimmed.length > maxLength) return undefined;
  return trimmed;
}

function readInputsObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_INPUT_FIELDS) return undefined;
  if (
    entries.some(([key]) => key.length === 0 || key.length > MAX_INPUT_FIELD_LENGTH)
  ) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readStringArray(
  value: unknown,
  maxItems: number,
  maxItemLength: number,
): string[] | undefined {
  if (!Array.isArray(value) || value.length > maxItems) return undefined;
  const normalized = value.map((item) => readBoundedString(item, maxItemLength));
  return normalized.every((item): item is string => Boolean(item))
    ? normalized
    : undefined;
}
