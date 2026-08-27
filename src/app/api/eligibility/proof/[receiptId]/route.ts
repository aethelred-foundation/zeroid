import { NextRequest } from "next/server";
import {
  BackendProxyConfigError,
  apiJson,
  buildBackendFetchSignal,
  buildBackendHeaders,
  getBackendApiBaseUrl,
  isBackendFetchTimeout,
  readBackendError,
  requireAuthorization,
} from "../../../_lib/backend";
import { validateBackendEligibilityResult } from "../../_lib/contract";

const RECEIPT_ID_PATTERN = /^[A-Za-z0-9._:-]{3,128}$/;

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ receiptId: string }> },
) {
  try {
    const { receiptId: rawReceiptId } = await context.params;
    const receiptId = rawReceiptId?.trim();
    if (!RECEIPT_ID_PATTERN.test(receiptId)) {
      return apiJson(
        {
          error: "Invalid eligibility receipt id",
          code: "ELIGIBILITY_RECEIPT_ID_INVALID",
        },
        { status: 400 },
      );
    }

    const authorization = requireAuthorization(request);
    if (!authorization) {
      return apiJson(
        {
          error: "Authorization bearer token required for receipt lookup",
          code: "ELIGIBILITY_RECEIPT_AUTH_REQUIRED",
        },
        { status: 401 },
      );
    }

    const apiUrl = getBackendApiBaseUrl();
    const response = await fetch(
      `${apiUrl}/api/v1/verification/eligibility-proof/${encodeURIComponent(
        receiptId,
      )}`,
      {
        method: "GET",
        headers: buildBackendHeaders(request, authorization),
        redirect: "manual",
        signal: buildBackendFetchSignal(),
      },
    );

    if (!response.ok) {
      return apiJson(
        {
          error: await readBackendError(
            response,
            "Backend eligibility receipt lookup failed",
          ),
          code: "ELIGIBILITY_RECEIPT_BACKEND_ERROR",
        },
        { status: response.status },
      );
    }

    const result = await response.json();
    const contractViolations = validateBackendEligibilityResult(result);
    if (contractViolations.length > 0) {
      return apiJson(
        {
          error:
            "Backend eligibility receipt response failed contract validation",
          code: "ELIGIBILITY_RECEIPT_CONTRACT_INVALID",
          details: { violations: contractViolations },
        },
        { status: 502 },
      );
    }

    return apiJson(
      {
        success: true,
        ...result,
        source: "backend",
        timestamp: new Date().toISOString(),
      },
      { status: response.status },
    );
  } catch (error) {
    if (error instanceof BackendProxyConfigError) {
      return apiJson(
        {
          error: error.message,
          code: "ELIGIBILITY_BACKEND_UNAVAILABLE",
        },
        { status: 503 },
      );
    }
    if (isBackendFetchTimeout(error)) {
      return apiJson(
        {
          error: "Backend request timed out",
          code: "ELIGIBILITY_BACKEND_TIMEOUT",
        },
        { status: 504 },
      );
    }

    return apiJson(
      {
        error: "Internal server error",
        code: "INTERNAL_ERROR",
      },
      { status: 500 },
    );
  }
}
