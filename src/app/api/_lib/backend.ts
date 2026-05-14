const DEFAULT_DEVELOPMENT_BACKEND_URL = "http://localhost:4000";

export class BackendProxyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendProxyConfigError";
  }
}

export function getBackendApiBaseUrl(): string {
  const configured = process.env.ZEROID_BACKEND_API_URL?.trim();
  if (configured) {
    return normalizeBaseUrl(configured);
  }

  if (process.env.NODE_ENV === "production") {
    throw new BackendProxyConfigError(
      "Backend API URL is not configured for production",
    );
  }

  return normalizeBaseUrl(
    process.env.NEXT_PUBLIC_ZEROID_API_URL ??
      process.env.NEXT_PUBLIC_API_URL ??
      DEFAULT_DEVELOPMENT_BACKEND_URL,
  );
}

export function requireAuthorization(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }
  return authorization;
}

export function buildBackendHeaders(
  request: Request,
  authorization: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: authorization,
  };

  const requestId = request.headers.get("x-request-id");
  if (requestId) {
    headers["X-Request-ID"] = requestId;
  }

  return headers;
}

export async function readBackendError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const payload = await response.json();
    return String(payload.message ?? payload.error ?? fallback);
  } catch {
    return fallback;
  }
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
