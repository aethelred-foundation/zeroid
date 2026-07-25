import nextEnv from "@next/env";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
nextEnv.loadEnvConfig(repositoryRoot, false);

const configuredOrigin =
  process.env.ZEROID_FRONTEND_ORIGIN?.trim() || "http://127.0.0.1:3003";
const origin = new URL(configuredOrigin);

if (
  !["http:", "https:"].includes(origin.protocol) ||
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
) {
  throw new Error(
    "ZEROID_FRONTEND_ORIGIN must be an HTTP(S) origin without credentials, a path, a query, or a fragment.",
  );
}

async function fetchOk(pathname, expectedContentType) {
  const url = new URL(pathname, origin);
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`${url.href} returned HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (expectedContentType && !contentType.includes(expectedContentType)) {
    throw new Error(
      `${url.href} returned ${contentType || "no content type"}; expected ${expectedContentType}`,
    );
  }

  const body = await response.arrayBuffer();
  return { url, contentType, body, headers: response.headers };
}

const page = await fetchOk("/", "text/html");
const html = new TextDecoder().decode(page.body);
const contentSecurityPolicy = page.headers.get("content-security-policy") || "";
const nonce = contentSecurityPolicy.match(/'nonce-([^']+)'/)?.[1];

if (!nonce) {
  throw new Error("The production page did not return a nonce-based CSP.");
}
if (
  origin.protocol === "http:" &&
  contentSecurityPolicy.includes("upgrade-insecure-requests")
) {
  throw new Error(
    "The direct HTTP response upgrades its own assets to HTTPS and will render without styling when TLS is not available on that port.",
  );
}

const configuredConnectionUrls = [
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
const configuredPlaintextOrigins = [
  ...new Set(
    configuredConnectionUrls.flatMap((configuredUrl) => {
      try {
        const url = new URL(configuredUrl || "");
        return url.protocol === "http:" || url.protocol === "ws:"
          ? [url.origin]
          : [];
      } catch {
        return [];
      }
    }),
  ),
];
if (
  configuredPlaintextOrigins.length > 0 &&
  (process.env.ZEROID_ALLOW_PLAINTEXT_HTTP !== "true" ||
    process.env.NEXT_PUBLIC_CHAIN_ENV !== "testnet")
) {
  throw new Error(
    `Plaintext browser endpoints are configured (${configuredPlaintextOrigins.join(
      ", ",
    )}) but the explicit testnet-only plaintext gate is not active. The browser CSP will block those calls.`,
  );
}

const connectSources = new Set(
  (
    contentSecurityPolicy
      .split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("connect-src ")) || ""
  )
    .split(/\s+/)
    .slice(1),
);
const missingConnectOrigins = configuredPlaintextOrigins.filter(
  (configuredPlaintextOrigin) => !connectSources.has(configuredPlaintextOrigin),
);
if (missingConnectOrigins.length > 0) {
  throw new Error(
    `The production CSP is missing configured browser connection origins: ${missingConnectOrigins.join(
      ", ",
    )}`,
  );
}

const inlineScripts = [
  ...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi),
].filter((match) => !/\bsrc\s*=/i.test(match[1]));
if (inlineScripts.length === 0) {
  throw new Error(
    "The production page did not contain Next.js bootstrap scripts.",
  );
}
const scriptsWithoutNonce = inlineScripts.filter(
  (match) => !match[1].includes(`nonce="${nonce}"`),
);
if (scriptsWithoutNonce.length > 0) {
  throw new Error(
    `${scriptsWithoutNonce.length} inline bootstrap script(s) did not carry the CSP nonce. The page will not hydrate in a browser.`,
  );
}

const fontPreloads = [
  ...(page.headers.get("link") || "").matchAll(
    /<([^>]+)>;\s*rel=preload;\s*as="font"/g,
  ),
].map((match) => match[1]);
const referencedAssets = [
  ...[...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((match) => match[1]),
  ...fontPreloads,
]
  .map((reference) => reference.replaceAll("&amp;", "&"))
  .filter(
    (reference) =>
      reference.startsWith("/_next/static/") ||
      reference.startsWith("/_next/image?") ||
      /^\/[A-Za-z0-9_./-]+\.(?:avif|css|gif|ico|jpe?g|js|png|svg|webp|woff2?)(?:\?|$)/.test(
        reference,
      ),
  );
const uniqueAssets = [...new Set(referencedAssets)];

if (!uniqueAssets.some((asset) => asset.includes("/_next/static/css/"))) {
  throw new Error(
    "The production page did not reference a generated CSS asset.",
  );
}
if (!uniqueAssets.some((asset) => asset.includes("/_next/static/chunks/"))) {
  throw new Error(
    "The production page did not reference a generated JavaScript asset.",
  );
}
if (!uniqueAssets.some((asset) => asset.includes("/_next/static/media/"))) {
  throw new Error(
    "The production page did not reference a generated font asset.",
  );
}
if (!uniqueAssets.some((asset) => asset.startsWith("/_next/image?"))) {
  throw new Error(
    "The production page did not reference an optimized image asset.",
  );
}

await Promise.all(uniqueAssets.map((asset) => fetchOk(asset)));
await fetchOk("/api/health", "application/json");

console.log(
  `ZeroID production smoke passed at ${origin.origin}: HTML, health, and ${uniqueAssets.length} assets returned successfully`,
);
