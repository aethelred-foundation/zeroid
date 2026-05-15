import { NextRequest, NextResponse } from "next/server";
import {
  BackendProxyConfigError,
  buildBackendHeaders,
  buildBackendFetchSignal,
  getBackendApiBaseUrl,
  isBackendFetchTimeout,
  JsonBodyReadError,
  readBackendError,
  readJsonObjectBody,
  requireAuthorization,
} from "../../_lib/backend";

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonObjectBody(request);
    if (!body) {
      return NextResponse.json(
        { error: "Request body must be a JSON object" },
        { status: 400 },
      );
    }

    const circuitName = body.circuitName ?? body.circuitType;
    const inputs = body.inputs ?? body.publicInputs;
    const { credentialId, selectiveDisclosure, audience, nonce } = body;

    if (!credentialId || !circuitName || !inputs || !audience) {
      return NextResponse.json(
        { error: "Missing credentialId, circuitName, inputs, or audience" },
        { status: 400 },
      );
    }

    if (typeof inputs !== "object" || Array.isArray(inputs)) {
      return NextResponse.json(
        {
          error: "Proof inputs must be an object keyed by circuit signal name",
        },
        { status: 400 },
      );
    }

    const authorization = requireAuthorization(request);
    if (!authorization) {
      return NextResponse.json(
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
        circuitName,
        inputs,
        selectiveDisclosure,
        audience,
        nonce,
      }),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: await readBackendError(response, "Proof generation failed") },
        { status: response.status },
      );
    }

    const proof = await response.json();
    return NextResponse.json(proof);
  } catch (error) {
    if (error instanceof BackendProxyConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof JsonBodyReadError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode },
      );
    }
    if (isBackendFetchTimeout(error)) {
      return NextResponse.json(
        { error: "Backend request timed out" },
        { status: 504 },
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
