import { NextRequest, NextResponse } from "next/server";
import {
  BackendProxyConfigError,
  buildBackendHeaders,
  getBackendApiBaseUrl,
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

    const credentialId = body.credentialId ?? body.credentialHash;
    const { proof, attributeName } = body;

    if (!credentialId || !proof) {
      return NextResponse.json(
        { error: "Missing credentialId or proof" },
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
    const encodedCredentialId = encodeURIComponent(String(credentialId));
    const response = await fetch(
      `${apiUrl}/api/v1/credentials/${encodedCredentialId}/verify`,
      {
        method: "POST",
        headers: buildBackendHeaders(request, authorization),
        body: JSON.stringify({ proof, attributeName }),
      },
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: await readBackendError(response, "Verification failed") },
        { status: response.status },
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BackendProxyConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
