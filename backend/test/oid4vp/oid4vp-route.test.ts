import express from "express";
import request from "supertest";

const mockCreate = jest.fn();
const mockGetReq = jest.fn();
const mockCallback = jest.fn();
const mockResult = jest.fn();
jest.mock("../../src/services/oid4vp/cross-device", () => ({
  createPresentationRequest: (...a: unknown[]) => mockCreate(...a),
  getRequestObject: (...a: unknown[]) => mockGetReq(...a),
  handleCallback: (...a: unknown[]) => mockCallback(...a),
  getResult: (...a: unknown[]) => mockResult(...a),
}));
const mockVerify = jest.fn();
jest.mock("../../src/services/oid4vp/verifier", () => ({
  verifyPresentation: (...a: unknown[]) => mockVerify(...a),
}));
jest.mock("../../src/runtime", () => ({
  prisma: {},
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));
jest.mock("../../src/middleware/auth", () => ({
  authMiddleware: (req: any, _res: unknown, next: () => void) => {
    req.identity = { id: "rp", did: "did:rp", status: "ACTIVE" };
    next();
  },
}));
jest.mock("../../src/middleware/rateLimit", () => ({
  apiRateLimiter: (_q: unknown, _s: unknown, n: () => void) => n(),
}));

import oid4vpRouter from "../../src/routes/oid4vp";

const POLICY_ID = "zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/oid4vp", oid4vpRouter);
  return app;
}

beforeEach(() => {
  [mockCreate, mockGetReq, mockCallback, mockResult, mockVerify].forEach((m) => m.mockReset());
});

describe("OpenID4VP routes", () => {
  it("POST /authorize persists a request and returns 201 with request_uri", async () => {
    mockCreate.mockResolvedValue({
      state: "st-1", nonce: "n-1", request_uri: "https://verifier.zeroid/api/v1/oid4vp/request/st-1",
      response_mode: "direct_post", response_type: "vp_token", dcql_query: { credentials: [] }, expires_in: 300,
    });
    const r = await request(makeApp())
      .post("/api/v1/oid4vp/authorize")
      .send({ policyId: POLICY_ID, audience: "https://verifier.zeroid" });
    expect(r.status).toBe(201);
    expect(r.body.request_uri).toContain("/oid4vp/request/st-1");
  });

  it("POST /authorize maps an unknown policy to 404", async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error("x"), { code: "POLICY_NOT_FOUND", statusCode: 404 }));
    const r = await request(makeApp())
      .post("/api/v1/oid4vp/authorize")
      .send({ policyId: "nope", audience: "rp" });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("POLICY_NOT_FOUND");
  });

  it("GET /request/:state returns the request object", async () => {
    mockGetReq.mockResolvedValue({ client_id: "x", nonce: "n-1", state: "st-1", dcql_query: { credentials: [] } });
    const r = await request(makeApp()).get("/api/v1/oid4vp/request/st-1");
    expect(r.status).toBe(200);
    expect(r.body.nonce).toBe("n-1");
    expect(mockGetReq).toHaveBeenCalledWith(expect.anything(), "st-1");
  });

  it("POST /callback verifies and acknowledges receipt", async () => {
    mockCallback.mockResolvedValue({ status: "ALLOWED" });
    const r = await request(makeApp())
      .post("/api/v1/oid4vp/callback")
      .send({ state: "st-1", vp_token: "iss~d~kb" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ received: true });
    expect(mockCallback).toHaveBeenCalledWith(expect.anything(), { state: "st-1", vpToken: "iss~d~kb" });
  });

  it("POST /callback maps a replayed/expired request to 401", async () => {
    mockCallback.mockRejectedValue(Object.assign(new Error("x"), { code: "VP_NONCE_INVALID", statusCode: 401 }));
    const r = await request(makeApp())
      .post("/api/v1/oid4vp/callback")
      .send({ state: "st-1", vp_token: "x~y" });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("VP_NONCE_INVALID");
  });

  it("POST /callback rejects an invalid body before verifying", async () => {
    const r = await request(makeApp()).post("/api/v1/oid4vp/callback").send({ state: "st-1" });
    expect(r.status).toBe(400);
    expect(mockCallback).not.toHaveBeenCalled();
  });

  it("GET /result/:state returns the stored decision", async () => {
    mockResult.mockResolvedValue({ status: "COMPLETED", decision: { status: "ALLOWED" } });
    const r = await request(makeApp()).get("/api/v1/oid4vp/result/st-1");
    expect(r.status).toBe(200);
    expect(r.body.decision.status).toBe("ALLOWED");
  });

  it("POST /verify (stateless) returns the decision", async () => {
    mockVerify.mockResolvedValue({ status: "ALLOWED" });
    const r = await request(makeApp())
      .post("/api/v1/oid4vp/verify")
      .send({ policyId: POLICY_ID, vpToken: "iss~d~kb", nonce: "n", audience: "rp" });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("ALLOWED");
  });
});
