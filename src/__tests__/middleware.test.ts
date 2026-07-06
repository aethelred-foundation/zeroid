import { NextRequest } from "next/server";

import {
  buildContentSecurityPolicy,
  config,
  middleware,
} from "@/middleware";

function directive(policy: string, name: string): string {
  return (
    policy
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `)) ?? ""
  );
}

describe("security middleware", () => {
  it("uses a nonce-based production script CSP without inline or eval allowances", () => {
    const policy = buildContentSecurityPolicy("testNonce123", true);
    const scriptSrc = directive(policy, "script-src");

    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).toContain("'nonce-testNonce123'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("keeps local development compatible with Next tooling only outside production", () => {
    const policy = buildContentSecurityPolicy("ignored", false);
    const scriptSrc = directive(policy, "script-src");

    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc).toContain("'unsafe-eval'");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("attaches a per-request CSP header for document routes", () => {
    const request = new NextRequest("https://app.zeroid.test/dashboard");
    const response = middleware(request);
    const policy = response.headers.get("Content-Security-Policy");

    expect(policy).toBeTruthy();
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("script-src-attr 'none'");
  });

  it("excludes APIs and static assets from the document CSP middleware", () => {
    expect(config.matcher[0]).toContain("(?!api|_next/static|_next/image");
    expect(config.matcher[0]).toContain("wasm");
  });
});
