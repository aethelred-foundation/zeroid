import { NextResponse } from "next/server";

const DEFAULT_DEVELOPMENT_BACKEND_URL = "http://localhost:4000";
const DEFAULT_BACKEND_FETCH_TIMEOUT_MS = 10_000;
const MIN_BACKEND_FETCH_TIMEOUT_MS = 100;
const MAX_BACKEND_FETCH_TIMEOUT_MS = 60_000;
const MAX_JSON_BODY_BYTES = 1_048_576;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_BEARER_TOKEN_LENGTH = 4096;
const BEARER_TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]+$/;
const MAX_BACKEND_ERROR_MESSAGE_LENGTH = 512;
const PRIVATE_NO_STORE_CACHE_CONTROL =
  "private, no-store, no-cache, must-revalidate, proxy-revalidate";

export class BackendProxyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendProxyConfigError";
  }
}

export class JsonBodyReadError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "JsonBodyReadError";
  }
}

export function apiJson<T>(body: T, init: ResponseInit = {}): NextResponse<T> {
  return privateJson(body, init);
}

export function privateJson<T>(
  body: T,
  init: ResponseInit = {},
): NextResponse<T> {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", PRIVATE_NO_STORE_CACHE_CONTROL);
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Vary", mergeVaryHeader(headers.get("Vary"), "Authorization"));

  return NextResponse.json(body, {
    ...init,
    headers,
  });
}

export function noStoreJson<T>(
  body: T,
  init: ResponseInit = {},
): NextResponse<T> {
  return privateJson(body, init);
}

export function getBackendApiBaseUrl(): string {
  const configured = process.env.ZEROID_BACKEND_API_URL?.trim();
  if (configured) {
    return normalizeBaseUrl(configured);
  }

  if (isProductionRuntime()) {
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
  const token = authorization.slice("Bearer ".length).trim();
  if (
    token.length === 0 ||
    token.length > MAX_BEARER_TOKEN_LENGTH ||
    !BEARER_TOKEN_PATTERN.test(token)
  ) {
    return null;
  }
  return `Bearer ${token}`;
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
  if (requestId && REQUEST_ID_PATTERN.test(requestId)) {
    headers["X-Request-ID"] = requestId;
  }

  return headers;
}

export function buildBackendFetchSignal(): AbortSignal {
  const timeoutMs = getBackendFetchTimeoutMs();
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  (timeout as { unref?: () => void }).unref?.();
  return controller.signal;
}

export function isBackendFetchTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

export async function readJsonObjectBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new JsonBodyReadError("Invalid Content-Length header", 400);
    }
    if (parsedLength > MAX_JSON_BODY_BYTES) {
      throw new JsonBodyReadError("Request body too large", 413);
    }
  }

  try {
    const rawBody = await readBodyTextWithLimit(request);
    const body = JSON.parse(rawBody);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof JsonBodyReadError) {
      throw error;
    }
    return null;
  }
}

export async function readBackendError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const payload = await response.json();
    return sanitizeBackendErrorMessage(
      payload.message ?? payload.error,
      fallback,
    );
  } catch {
    return fallback;
  }
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BackendProxyConfigError(
      "Backend API URL must be an absolute URL",
    );
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new BackendProxyConfigError("Backend API URL must use HTTP or HTTPS");
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new BackendProxyConfigError(
      "Backend API URL must not include credentials, query, or fragment",
    );
  }

  if (isProductionRuntime()) {
    const allowPlaintext =
      process.env.ZEROID_ALLOW_PLAINTEXT_HTTP === "true" &&
      process.env.NEXT_PUBLIC_CHAIN_ENV === "testnet";
    if (url.protocol !== "https:" && !allowPlaintext) {
      throw new BackendProxyConfigError(
        "Backend API URL must use HTTPS in production",
      );
    }
    if (isLocalOrPrivateHostname(url.hostname) && !allowPlaintext) {
      throw new BackendProxyConfigError(
        "Backend API URL must not target local or private hosts in production",
      );
    }
  }

  return url.toString().replace(/\/+$/, "");
}

export function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.ZEROID_ENV === "production"
  );
}

function getBackendFetchTimeoutMs(): number {
  const configured = process.env.ZEROID_BACKEND_FETCH_TIMEOUT_MS?.trim();
  if (!configured) return DEFAULT_BACKEND_FETCH_TIMEOUT_MS;

  const parsed = Number(configured);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_BACKEND_FETCH_TIMEOUT_MS ||
    parsed > MAX_BACKEND_FETCH_TIMEOUT_MS
  ) {
    return DEFAULT_BACKEND_FETCH_TIMEOUT_MS;
  }

  return parsed;
}

function mergeVaryHeader(existing: string | null, value: string): string {
  const fields = new Set(
    (existing ?? "")
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean),
  );
  fields.add(value);
  return Array.from(fields).join(", ");
}

function sanitizeBackendErrorMessage(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!normalized) return fallback;
  if (normalized.length <= MAX_BACKEND_ERROR_MESSAGE_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_BACKEND_ERROR_MESSAGE_LENGTH - 1)}…`;
}

async function readBodyTextWithLimit(request: Request): Promise<string> {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    received += value.byteLength;
    if (received > MAX_JSON_BODY_BYTES) {
      await reader.cancel();
      throw new JsonBodyReadError("Request body too large", 413);
    }

    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function isLocalOrPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (
    normalized === "localhost" ||
    normalized === "0.0.0.0" ||
    normalized === "::" ||
    normalized === "::1" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local")
  ) {
    return true;
  }

  if (/^127\./.test(normalized) || /^10\./.test(normalized)) return true;
  if (/^192\.168\./.test(normalized)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)) return true;
  return /^(fc|fd|fe80):/i.test(normalized);
}
