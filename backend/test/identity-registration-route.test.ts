import express from "express";
import request from "supertest";

const mockRegisterIdentity = jest.fn();

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

jest.mock("../src/services/identity", () => ({
  identityService: {
    register: mockRegisterIdentity,
  },
}));

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
  authRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { identityRoutes } from "../src/routes/identity";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/identity", identityRoutes);
  return app;
}

const validRegistration = {
  did: "did:aethelred:testnet:0x1234567890abcdef1234567890abcdef12345678",
  controller: "0x1234567890abcdef1234567890abcdef12345678",
  publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  recoveryHash: "a".repeat(64),
  signature: `0x${"1".repeat(128)}1b`,
  metadata: {
    txHash: `0x${"2".repeat(64)}`,
    didHash: `0x${"3".repeat(64)}`,
  },
};

describe("identity registration route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("fails closed before identity, session, or audit persistence", async () => {
    const response = await request(buildApp())
      .post("/api/v1/identity/register")
      .send(validRegistration)
      .expect(503);

    expect(response.body).toEqual({
      error:
        "Identity registration is unavailable until the registry transaction can be verified server-side. No identity or session was created.",
      code: "IDENTITY_REGISTRY_VERIFICATION_UNAVAILABLE",
    });
    expect(mockRegisterIdentity).not.toHaveBeenCalled();
  });

  it("still validates the registration payload before reporting availability", async () => {
    const response = await request(buildApp())
      .post("/api/v1/identity/register")
      .send({ ...validRegistration, txHash: "attacker-controlled" })
      .expect(400);

    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(mockRegisterIdentity).not.toHaveBeenCalled();
  });
});
