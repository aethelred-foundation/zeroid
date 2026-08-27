import express from "express";
import request from "supertest";
import type { Express, NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../src/middleware/auth";

const IDENTITY = {
  id: "identity-1",
  did: "did:aethelred:testnet:0x1234567890123456789012345678901234567890",
  publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  status: "ACTIVE",
};

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(async () => "OK"),
  del: jest.fn(async () => 1),
};

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const mockGovernmentAPIService = {
  getVerificationStatus: jest.fn(async () => null),
  getUAEPassAuthUrl: jest.fn(
    (redirectUri: string, state: string) =>
      `https://uaepass.example/authorize?redirect=${encodeURIComponent(redirectUri)}&state=${state}`,
  ),
  authenticateWithUAEPass: jest.fn(async () => ({
    verified: true,
    provider: "UAE_PASS",
    referenceId: "uaepass-ref-1",
    verifiedFields: ["fullName", "nationality"],
    verifiedAt: new Date("2026-06-25T10:00:00.000Z"),
    expiresAt: new Date("2027-06-25T10:00:00.000Z"),
  })),
};

const mockIdentityService = {
  register: jest.fn(),
  getIdentity: jest.fn(),
  recoverIdentity: jest.fn(async () => ({
    identity: IDENTITY,
    token: "unexpected-recovery-token",
    sessionId: "unexpected-recovery-session",
  })),
  addDelegation: jest.fn(),
  revokeDelegation: jest.fn(),
  logout: jest.fn(),
  updateIdentity: jest.fn(),
};

jest.mock("../src/runtime", () => ({
  prisma: {
    identity: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
  },
  redis: mockRedis,
  logger: mockLogger,
}));

jest.mock("../src/services/government-api", () => ({
  governmentAPIService: mockGovernmentAPIService,
}));

jest.mock("../src/services/identity", () => ({
  identityService: mockIdentityService,
}));

jest.mock("../src/services/tee", () => ({
  teeService: {
    isAttestationValid: jest.fn(async () => false),
  },
}));

jest.mock("../src/middleware/auth", () => ({
  authMiddleware: (
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction,
  ): void => {
    req.identity = IDENTITY;
    next();
  },
  optionalAuthMiddleware: (
    _req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction,
  ): void => {
    next();
  },
}));

jest.mock("../src/middleware/rateLimit", () => ({
  apiRateLimiter: (
    _req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction,
  ): void => next(),
  authRateLimiter: (
    _req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction,
  ): void => next(),
}));

import { identityRoutes } from "../src/routes/identity";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/identity", identityRoutes);
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found", code: "ROUTE_NOT_FOUND" });
  });
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRedis.get.mockResolvedValue(null);
});

describe("identity government verification routes", () => {
  it.each([
    "verified_oidc_claims",
    "verifiedOIDCClaims",
    "verifiedClaims",
    "verified_claims",
    "governmentVerification",
    "kyc_level",
    "tee_attestation_id",
    "controller",
    "futureAuthoritativeNamespace",
  ])("rejects non-client-writable profile metadata key %s", async (reservedKey) => {
    const res = await request(buildApp())
      .patch("/api/v1/identity/me")
      .send({
        metadata: {
          [reservedKey]: { name: "attacker-controlled" },
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(mockIdentityService.updateIdentity).not.toHaveBeenCalled();
  });

  it("starts UAE Pass OAuth with a state bound to the authenticated identity", async () => {
    const res = await request(buildApp())
      .post("/api/v1/identity/government/uae-pass/start")
      .send({
        redirectUri: "https://app.zeroid.test/identity/uae-pass/callback",
      });

    expect(res.status).toBe(201);
    expect(res.body.data.authUrl).toContain(
      "https://uaepass.example/authorize",
    );
    expect(res.body.data.state).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(res.body.data.expiresInSeconds).toBe(600);
    expect(mockGovernmentAPIService.getUAEPassAuthUrl).toHaveBeenCalledWith(
      "https://app.zeroid.test/identity/uae-pass/callback",
      res.body.data.state,
    );

    const [, storedValue, mode, ttl] = mockRedis.set.mock.calls[0];
    expect(mode).toBe("EX");
    expect(ttl).toBe(600);
    expect(JSON.parse(storedValue)).toMatchObject({
      identityId: IDENTITY.id,
      redirectUri: "https://app.zeroid.test/identity/uae-pass/callback",
    });
  });

  it("rejects unsafe UAE Pass redirect URIs before state creation", async () => {
    const res = await request(buildApp())
      .post("/api/v1/identity/government/uae-pass/start")
      .send({
        redirectUri: "ftp://app.zeroid.test/identity/uae-pass/callback",
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(mockRedis.set).not.toHaveBeenCalled();
    expect(mockGovernmentAPIService.getUAEPassAuthUrl).not.toHaveBeenCalled();
  });

  it("completes UAE Pass OAuth using the stored redirect URI and consumes state", async () => {
    mockRedis.get.mockResolvedValue(
      JSON.stringify({
        identityId: IDENTITY.id,
        redirectUri: "https://app.zeroid.test/identity/uae-pass/callback",
        issuedAt: "2026-06-25T09:55:00.000Z",
      }),
    );

    const res = await request(buildApp())
      .post("/api/v1/identity/government/uae-pass/callback")
      .send({
        code: "oauth-code-123",
        state: "state_abcdefghijklmnopqrstuvwxyz123456",
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      verified: true,
      provider: "UAE_PASS",
      referenceId: "uaepass-ref-1",
    });
    expect(mockRedis.del).toHaveBeenCalledWith(
      "gov:uaepass:oauth:state:state_abcdefghijklmnopqrstuvwxyz123456",
    );
    expect(
      mockGovernmentAPIService.authenticateWithUAEPass,
    ).toHaveBeenCalledWith({
      authorizationCode: "oauth-code-123",
      redirectUri: "https://app.zeroid.test/identity/uae-pass/callback",
      identityId: IDENTITY.id,
    });
  });

  it("rejects UAE Pass callback state owned by another identity", async () => {
    mockRedis.get.mockResolvedValue(
      JSON.stringify({
        identityId: "identity-2",
        redirectUri: "https://app.zeroid.test/identity/uae-pass/callback",
        issuedAt: "2026-06-25T09:55:00.000Z",
      }),
    );

    const res = await request(buildApp())
      .post("/api/v1/identity/government/uae-pass/callback")
      .send({
        authorizationCode: "oauth-code-123",
        state: "state_abcdefghijklmnopqrstuvwxyz123456",
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("UAE_PASS_STATE_FORBIDDEN");
    expect(mockRedis.del).not.toHaveBeenCalled();
    expect(
      mockGovernmentAPIService.authenticateWithUAEPass,
    ).not.toHaveBeenCalled();
  });

  it("rejects malformed UAE Pass callback state records before government exchange", async () => {
    mockRedis.get.mockResolvedValue(
      JSON.stringify({
        identityId: IDENTITY.id,
        redirectUri: "javascript:alert(1)",
        issuedAt: "2026-06-25T09:55:00.000Z",
      }),
    );

    const res = await request(buildApp())
      .post("/api/v1/identity/government/uae-pass/callback")
      .send({
        authorizationCode: "oauth-code-123",
        state: "state_abcdefghijklmnopqrstuvwxyz123456",
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UAE_PASS_STATE_INVALID");
    expect(mockRedis.del).not.toHaveBeenCalled();
    expect(
      mockGovernmentAPIService.authenticateWithUAEPass,
    ).not.toHaveBeenCalled();
  });

  it("returns authenticated government verification status from the service", async () => {
    mockGovernmentAPIService.getVerificationStatus.mockResolvedValueOnce({
      verified: true,
      provider: "UAE_PASS",
      referenceId: "uaepass-ref-2",
      verifiedFields: ["fullName"],
      verifiedAt: new Date("2026-06-25T10:00:00.000Z"),
      expiresAt: new Date("2027-06-25T10:00:00.000Z"),
    });

    const res = await request(buildApp()).get(
      "/api/v1/identity/government/status",
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      verified: true,
      provider: "UAE_PASS",
      referenceId: "uaepass-ref-2",
      verifiedFields: ["fullName"],
    });
    expect(mockGovernmentAPIService.getVerificationStatus).toHaveBeenCalledWith(
      IDENTITY.id,
    );
  });

  it("returns null government status when the service has no current record", async () => {
    mockGovernmentAPIService.getVerificationStatus.mockResolvedValueOnce(null);

    const res = await request(buildApp()).get(
      "/api/v1/identity/government/status",
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
    expect(mockGovernmentAPIService.getVerificationStatus).toHaveBeenCalledWith(
      IDENTITY.id,
    );
  });
});

describe("retired legacy identity lifecycle routes", () => {
  it.each([
    {
      method: "post" as const,
      path: "/api/v1/identity/recover",
      body: {
        did: IDENTITY.did,
        recoveryProof: "r".repeat(64),
        newPublicKey: "A".repeat(44),
        newRecoveryHash: "a".repeat(64),
      },
    },
    {
      method: "post" as const,
      path: "/api/v1/identity/delegate",
      body: {
        delegateDid:
          "did:aethelred:testnet:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      },
    },
    {
      method: "delete" as const,
      path:
        "/api/v1/identity/delegate/did%3Aaethelred%3Atestnet%3A0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      body: undefined,
    },
  ])("does not expose $method $path", async ({ method, path, body }) => {
    let pendingRequest = request(buildApp())[method](path);
    if (body !== undefined) {
      pendingRequest = pendingRequest.send(body);
    }

    const res = await pendingRequest;

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: "Not found",
      code: "ROUTE_NOT_FOUND",
    });
    expect(res.text).not.toContain("unexpected-recovery-token");
    expect(res.text).not.toContain("unexpected-recovery-session");
    expect(mockIdentityService.recoverIdentity).not.toHaveBeenCalled();
    expect(mockIdentityService.addDelegation).not.toHaveBeenCalled();
    expect(mockIdentityService.revokeDelegation).not.toHaveBeenCalled();
    expect(mockIdentityService.register).not.toHaveBeenCalled();
    expect(mockIdentityService.updateIdentity).not.toHaveBeenCalled();
    expect(mockIdentityService.logout).not.toHaveBeenCalled();
  });
});
