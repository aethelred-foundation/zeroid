import { NextRequest } from "next/server";

import {
  buildContentSecurityPolicy,
  config,
  getConfiguredPlaintextConnectSources,
  isHttpsRequest,
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

  it("does not upgrade assets when production is served over direct HTTP", () => {
    const policy = buildContentSecurityPolicy("testNonce123", true, false);

    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("recognizes direct and reverse-proxied HTTPS requests", () => {
    expect(isHttpsRequest(new NextRequest("https://app.zeroid.test/"))).toBe(
      true,
    );
    expect(isHttpsRequest(new NextRequest("http://127.0.0.1:3003/"))).toBe(
      false,
    );
    expect(
      isHttpsRequest(
        new NextRequest("http://zeroid.internal/", {
          headers: { "x-forwarded-proto": "https" },
        }),
      ),
    ).toBe(true);
  });

  it("allows only explicitly configured plaintext connection origins", () => {
    const plaintextOrigins = getConfiguredPlaintextConnectSources(true, [
      "http://93.127.132.52:4003/v1",
      "http://54.165.44.130:8545",
      "http://93.127.132.52:4003/another-path",
      "ws://93.127.132.52:4003/ws",
      "https://secure.example.test",
      "not-a-url",
      "http://user:password@example.test",
    ]);

    expect(plaintextOrigins).toEqual([
      "http://93.127.132.52:4003",
      "http://54.165.44.130:8545",
      "ws://93.127.132.52:4003",
    ]);

    const policy = buildContentSecurityPolicy(
      "testNonce123",
      true,
      false,
      plaintextOrigins,
    );
    const connectSrc = directive(policy, "connect-src");

    expect(connectSrc).toContain("http://93.127.132.52:4003");
    expect(connectSrc).toContain("http://54.165.44.130:8545");
    expect(connectSrc).toContain("ws://93.127.132.52:4003");
    expect(connectSrc).not.toMatch(/(?:^|\s)http:(?:\s|$)/);
    expect(connectSrc).not.toMatch(/(?:^|\s)ws:(?:\s|$)/);
  });

  it("keeps plaintext connection origins disabled without the explicit gate", () => {
    expect(
      getConfiguredPlaintextConnectSources(false, [
        "http://93.127.132.52:4003",
      ]),
    ).toEqual([]);
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
