import express from "express";
import request from "supertest";

const mockRegisterIdentity = jest.fn();
const mockRegistrationLimiter = jest.fn(
  (_req: unknown, _res: unknown, next: () => void) => next(),
);
const mockAuthLimiter = jest.fn(
  (_req: unknown, _res: unknown, next: () => void) => next(),
);

jest.mock("../src/runtime", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  prisma: {
    identity: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
  },
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

jest.mock("../src/services/identity", () => {
  class IdentityError extends Error {
    code: string;
    statusCode: number;
    constructor(message: string, code: string, statusCode = 400) {
      super(message);
      this.code = code;
      this.statusCode = statusCode;
    }
  }
  return {
    IdentityError,
    identityService: {
      register: mockRegisterIdentity,
    },
  };
});

jest.mock("../src/services/government-api", () => ({
  governmentAPIService: {},
}));

jest.mock("../src/services/tee", () => ({
  teeService: {},
}));

jest.mock("../src/middleware/auth", () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  optionalAuthMiddleware: (
    _req: unknown,
    _res: unknown,
    next: () => void,
  ) => next(),
}));

jest.mock("../src/middleware/rateLimit", () => ({
  apiRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  authRateLimiter: (req: unknown, res: unknown, next: () => void) =>
    mockAuthLimiter(req, res, next),
  identityRegistrationRateLimiter: (
    req: unknown,
    res: unknown,
    next: () => void,
  ) => mockRegistrationLimiter(req, res, next),
}));

import { identityRoutes } from "../src/routes/identity";
import { IdentityError } from "../src/services/identity";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/identity", identityRoutes);
  return app;
}

const TX_HASH = `0x${"AB".repeat(32)}`;

const validRegistration = {
  did: "did:aethelred:testnet:0x1234567890abcdef1234567890abcdef12345678",
  controller: "0x1234567890abcdef1234567890abcdef12345678",
  publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  recoveryHash: "a".repeat(64),
  signature: `0x${"1".repeat(128)}1b`,
  txHash: TX_HASH,
  metadata: {
    didDocument: {
      id: "did:aethelred:testnet:0x1234567890abcdef1234567890abcdef12345678",
    },
  },
};

const registered = {
  identity: { id: "identity-1", did: validRegistration.did },
  token: "session-token",
  sessionId: "session-1",
};

describe("identity registration route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRegisterIdentity.mockResolvedValue(registered);
  });

  it("returns 201 with the identity and session once the service verifies the registration", async () => {
    const response = await request(buildApp())
      .post("/api/v1/identity/register")
      .send(validRegistration)
      .expect(201);

    expect(response.body).toEqual({
      data: registered,
      message: "Identity registered successfully",
    });
    expect(mockRegisterIdentity).toHaveBeenCalledWith({
      did: validRegistration.did,
      controller: validRegistration.controller,
      publicKey: validRegistration.publicKey,
      recoveryHash: validRegistration.recoveryHash,
      signature: validRegistration.signature,
      txHash: TX_HASH.toLowerCase(),
      displayName: undefined,
      metadata: validRegistration.metadata,
    });
  });

  it("uses the dedicated registration limiter rather than the sign-in limiter", async () => {
    await request(buildApp())
      .post("/api/v1/identity/register")
      .send(validRegistration)
      .expect(201);

    expect(mockRegistrationLimiter).toHaveBeenCalledTimes(1);
    expect(mockAuthLimiter).not.toHaveBeenCalled();
  });

  it.each([
    ["missing txHash", { ...validRegistration, txHash: undefined }],
    ["malformed txHash", { ...validRegistration, txHash: "attacker-controlled" }],
    ["short txHash", { ...validRegistration, txHash: `0x${"1".repeat(62)}` }],
    [
      "client-supplied txHash metadata",
      { ...validRegistration, metadata: { txHash: TX_HASH } },
    ],
    [
      "client-supplied didHash metadata",
      { ...validRegistration, metadata: { didHash: `0x${"3".repeat(64)}` } },
    ],
    ["unknown top-level field", { ...validRegistration, didHash: TX_HASH }],
  ])("rejects %s with 400 before the service runs", async (_label, body) => {
    const response = await request(buildApp())
      .post("/api/v1/identity/register")
      .send(body)
      .expect(400);

    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(mockRegisterIdentity).not.toHaveBeenCalled();
  });

  it.each([
    ["IDENTITY_DID_NETWORK_MISMATCH", 400],
    ["IDENTITY_REGISTRATION_PROOF_INVALID", 401],
    ["IDENTITY_DID_EXISTS", 409],
    ["IDENTITY_REGISTRY_TX_ALREADY_USED", 409],
    ["IDENTITY_CONTROLLER_EXISTS", 409],
    ["IDENTITY_REGISTRY_TX_NOT_MINED", 409],
    ["IDENTITY_REGISTRY_TX_NOT_CONFIRMED", 409],
    ["IDENTITY_REGISTRY_TX_REVERTED", 422],
    ["IDENTITY_REGISTRY_CHAIN_MISMATCH", 422],
    ["IDENTITY_REGISTRY_WRONG_TARGET", 422],
    ["IDENTITY_REGISTRY_SENDER_MISMATCH", 422],
    ["IDENTITY_REGISTRY_WRONG_FUNCTION", 422],
    ["IDENTITY_REGISTRY_ARGUMENT_MISMATCH", 422],
    ["IDENTITY_REGISTRY_EVENT_MISSING", 422],
    ["IDENTITY_REGISTRY_EVENT_MISMATCH", 422],
    ["IDENTITY_REGISTRY_STATE_MISMATCH", 422],
  ])("propagates %s as %s with its code", async (code, status) => {
    mockRegisterIdentity.mockRejectedValue(
      new IdentityError(`refused: ${code}`, code, status),
    );

    const response = await request(buildApp())
      .post("/api/v1/identity/register")
      .send(validRegistration)
      .expect(status);

    expect(response.body).toEqual({ error: `refused: ${code}`, code });
  });

  it.each([
    "IDENTITY_REGISTRY_NOT_CONFIGURED",
    "IDENTITY_REGISTRY_RPC_UNAVAILABLE",
    "IDENTITY_REGISTRATION_NOT_CONFIGURED",
  ])("surfaces the %s 503 unmasked", async (code) => {
    mockRegisterIdentity.mockRejectedValue(
      new IdentityError("Registration is not ready", code, 503),
    );

    const response = await request(buildApp())
      .post("/api/v1/identity/register")
      .send(validRegistration)
      .expect(503);

    expect(response.body).toEqual({ error: "Registration is not ready", code });
  });

  it("still masks unexpected server failures", async () => {
    mockRegisterIdentity.mockRejectedValue(
      new Error("prisma connection string leaked://user:pw@host"),
    );

    const response = await request(buildApp())
      .post("/api/v1/identity/register")
      .send(validRegistration)
      .expect(500);

    expect(response.body).toEqual({
      error: "Internal server error",
      code: "IDENTITY_REGISTER_FAILED",
    });
  });

  it("masks a 5xx IdentityError whose code is not on the passthrough list", async () => {
    mockRegisterIdentity.mockRejectedValue(
      new IdentityError(
        "audit transaction unavailable",
        "IDENTITY_AUDIT_TRANSACTION_UNAVAILABLE",
        500,
      ),
    );

    const response = await request(buildApp())
      .post("/api/v1/identity/register")
      .send(validRegistration)
      .expect(500);

    expect(response.body).toEqual({
      error: "Internal server error",
      code: "IDENTITY_REGISTER_FAILED",
    });
  });
});
