import express from "express";
import request from "supertest";

const mockOffer = jest.fn();
const mockToken = jest.fn();
const mockIssue = jest.fn();
jest.mock("../../src/services/oid4vci/issuance", () => {
  const actual = jest.requireActual("../../src/services/oid4vci/issuance");
  return {
    ...actual,
    createCredentialOffer: (...a: unknown[]) => mockOffer(...a),
    redeemPreAuthorizedCode: (...a: unknown[]) => mockToken(...a),
    issueCredential: (...a: unknown[]) => mockIssue(...a),
  };
});
jest.mock("../../src/index", () => ({
  prisma: {},
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));
jest.mock("../../src/middleware/auth", () => ({
  authMiddleware: (req: any, _res: unknown, next: () => void) => {
    req.identity = { id: "op", did: "did:op", status: "ACTIVE" };
    next();
  },
}));
jest.mock("../../src/middleware/rateLimit", () => ({
  apiRateLimiter: (_q: unknown, _s: unknown, n: () => void) => n(),
}));

import oid4vciRouter from "../../src/routes/oid4vci";

const PRE_AUTH = "urn:ietf:params:oauth:grant-type:pre-authorized_code";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/oid4vci", oid4vciRouter);
  return app;
}

beforeEach(() => {
  mockOffer.mockReset();
  mockToken.mockReset();
  mockIssue.mockReset();
});

describe("OpenID4VCI routes", () => {
  it("GET /.well-known/openid-credential-issuer returns issuer metadata", async () => {
    const r = await request(makeApp()).get("/api/v1/oid4vci/.well-known/openid-credential-issuer");
    expect(r.status).toBe(200);
    expect(r.body.credential_issuer).toEqual(expect.any(String));
    expect(r.body.credential_configurations_supported).toHaveProperty("regulated-eligibility-v1");
  });

  it("POST /credential-offer mints an offer (201)", async () => {
    mockOffer.mockResolvedValue({
      offer: { credential_issuer: "x", credential_configuration_ids: ["regulated-eligibility-v1"], grants: {} },
      preAuthorizedCode: "pac-1",
    });
    const r = await request(makeApp())
      .post("/api/v1/oid4vci/credential-offer")
      .send({ configId: "regulated-eligibility-v1", subjectDid: "did:z:alice" });
    expect(r.status).toBe(201);
    expect(r.body.pre_authorized_code).toBe("pac-1");
    expect(r.body.credential_offer.credential_configuration_ids).toEqual(["regulated-eligibility-v1"]);
  });

  it("POST /token exchanges a pre-authorized code (200)", async () => {
    mockToken.mockResolvedValue({
      access_token: "at-1", token_type: "bearer", expires_in: 600, c_nonce: "cn-1", c_nonce_expires_in: 600,
    });
    const r = await request(makeApp())
      .post("/api/v1/oid4vci/token")
      .send({ grant_type: PRE_AUTH, "pre-authorized_code": "pac-1" });
    expect(r.status).toBe(200);
    expect(r.body.access_token).toBe("at-1");
    expect(r.body.c_nonce).toBe("cn-1");
  });

  it("POST /credential issues with a Bearer token (200)", async () => {
    mockIssue.mockResolvedValue({ credential: "issuerJwt~d~", format: "dc+sd-jwt" });
    const r = await request(makeApp())
      .post("/api/v1/oid4vci/credential")
      .set("Authorization", "Bearer at-1")
      .send({ proof: { proof_type: "jwt", jwt: "proof.jwt.sig" } });
    expect(r.status).toBe(200);
    expect(r.body.format).toBe("dc+sd-jwt");
    expect(mockIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accessToken: "at-1", proofJwt: "proof.jwt.sig" }),
    );
  });

  it("POST /credential without a Bearer token is 401 invalid_token", async () => {
    const r = await request(makeApp())
      .post("/api/v1/oid4vci/credential")
      .send({ proof: { proof_type: "jwt", jwt: "p" } });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("invalid_token");
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it("POST /credential with an invalid body is 400 before issuance", async () => {
    const r = await request(makeApp())
      .post("/api/v1/oid4vci/credential")
      .set("Authorization", "Bearer at-1")
      .send({ proof: { proof_type: "jwt" } }); // missing jwt
    expect(r.status).toBe(400);
    expect(mockIssue).not.toHaveBeenCalled();
  });
});
