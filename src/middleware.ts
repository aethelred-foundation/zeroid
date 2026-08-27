import { NextRequest, NextResponse } from "next/server";

const isProductionRuntime = process.env.NODE_ENV === "production";

function configuredBrowserConnectionUrls(): Array<string | undefined> {
  return [
    process.env.NEXT_PUBLIC_ZEROID_API_URL,
    process.env.NEXT_PUBLIC_API_URL,
    process.env.NEXT_PUBLIC_AETHELRED_MAINNET_RPC_URL,
    process.env.NEXT_PUBLIC_AETHELRED_MAINNET_WS_URL,
    process.env.NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL,
    process.env.NEXT_PUBLIC_AETHELRED_DEVNET_RPC_URL,
    process.env.NEXT_PUBLIC_TEE_SERVICE_URL,
    process.env.NEXT_PUBLIC_BRIDGE_RELAYER_URL,
    process.env.NEXT_PUBLIC_BRIDGE_DESTINATION_VERIFICATION_URL,
  ];
}

export function getConfiguredPlaintextConnectSources(
  allowPlaintext = process.env.ZEROID_ALLOW_PLAINTEXT_HTTP === "true" &&
    process.env.NEXT_PUBLIC_CHAIN_ENV === "testnet",
  configuredUrls = configuredBrowserConnectionUrls(),
): string[] {
  if (!allowPlaintext) return [];

  const origins = new Set<string>();
  for (const configuredUrl of configuredUrls) {
    const value = configuredUrl?.trim();
    if (!value) continue;

    try {
      const url = new URL(value);
      if (
        !url.username &&
        !url.password &&
        (url.protocol === "http:" || url.protocol === "ws:")
      ) {
        origins.add(url.origin);
      }
    } catch {
      // URL validation belongs to the relevant integration. Invalid optional
      // values must not broaden CSP or make every document request fail.
    }
  }

  return [...origins];
}

function createCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function buildContentSecurityPolicy(
  nonce: string,
  production = isProductionRuntime,
  upgradeInsecureRequests = production,
  plaintextConnectSources = production
    ? getConfiguredPlaintextConnectSources()
    : [],
): string {
  const scriptSrc = production
    ? `script-src 'self' 'nonce-${nonce}'`
    : "script-src 'self' 'unsafe-eval' 'unsafe-inline'";
  const connectSrc = production
    ? [
        "connect-src",
        "'self'",
        "https:",
        "wss:",
        ...plaintextConnectSources,
      ].join(" ")
    : "connect-src 'self' http: https: ws: wss:";

  return [
    "default-src 'self'",
    scriptSrc,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    connectSrc,
    "media-src 'self' blob:",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(production && upgradeInsecureRequests
      ? ["upgrade-insecure-requests"]
      : []),
  ].join("; ");
}

export function isHttpsRequest(request: NextRequest): boolean {
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    .trim()
    .toLowerCase();

  return request.nextUrl.protocol === "https:" || forwardedProtocol === "https";
}

export function middleware(request: NextRequest) {
  const nonce = createCspNonce();
  const csp = buildContentSecurityPolicy(
    nonce,
    isProductionRuntime,
    isHttpsRequest(request),
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:avif|css|gif|ico|jpg|jpeg|js|json|map|png|svg|ttf|txt|wasm|webp|woff|woff2|xml)$).*)",
  ],
};
