import express from "express";
import request from "supertest";

const mockVerify = jest.fn();
jest.mock("../../src/services/oid4vp/verifier", () => ({
  verifyPresentation: (...a: unknown[]) => mockVerify(...a),
}));
jest.mock("../../src/index", () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));
jest.mock("../../src/middleware/auth", () => ({
  authMiddleware: (req: any, _res: unknown, next: () => void) => {
    req.identity = { id: "v1", did: "did:rp", status: "ACTIVE" };
    next();
  },
}));
jest.mock("../../src/middleware/rateLimit", () => ({
  apiRateLimiter: (_q: unknown, _s: unknown, n: () => void) => n(),
}));

import oid4vpRouter from "../../src/routes/oid4vp";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/oid4vp", oid4vpRouter);
  return app;
}

const POLICY_ID = "zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1";

beforeEach(() => mockVerify.mockReset());

describe("POST /api/v1/oid4vp/authorize", () => {
  it("returns a DCQL presentation request for a known policy", async () => {
    const r = await request(makeApp())
      .post("/api/v1/oid4vp/authorize")
      .send({ policyId: POLICY_ID, audience: "https://verifier.zeroid" });
    expect(r.status).toBe(200);
    expect(r.body.nonce).toEqual(expect.any(String));
    expect(r.body.dcql_query.credentials[0].meta.vct_values).toEqual([
      "https://credentials.zeroid/regulated-eligibility/v1",
    ]);
    expect(r.body.response_type).toBe("vp_token");
  });

  it("returns 404 POLICY_NOT_FOUND for an unknown policy", async () => {
    const r = await request(makeApp())
      .post("/api/v1/oid4vp/authorize")
      .send({ policyId: "nope", audience: "rp" });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("POLICY_NOT_FOUND");
  });
});

describe("POST /api/v1/oid4vp/verify", () => {
  it("returns the decision on success", async () => {
    mockVerify.mockResolvedValue({ status: "ALLOWED", policyId: POLICY_ID, reasons: [] });
    const r = await request(makeApp())
      .post("/api/v1/oid4vp/verify")
      .send({ policyId: POLICY_ID, vpToken: "iss~d~kb", nonce: "n", audience: "rp" });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("ALLOWED");
    expect(mockVerify).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ policyId: POLICY_ID, vpToken: "iss~d~kb", nonce: "n" }),
    );
  });

  it("maps a verification failure to its HTTP status + code", async () => {
    mockVerify.mockRejectedValue(
      Object.assign(new Error("bad sig"), { code: "VP_TOKEN_INVALID", statusCode: 401 }),
    );
    const r = await request(makeApp())
      .post("/api/v1/oid4vp/verify")
      .send({ policyId: POLICY_ID, vpToken: "x~y", nonce: "n", audience: "rp" });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("VP_TOKEN_INVALID");
  });

  it("returns 400 on an invalid body without calling the verifier", async () => {
    const r = await request(makeApp())
      .post("/api/v1/oid4vp/verify")
      .send({ policyId: POLICY_ID, nonce: "n" }); // missing vpToken + audience
    expect(r.status).toBe(400);
    expect(mockVerify).not.toHaveBeenCalled();
  });
});
