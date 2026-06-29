import {
  ServiceError,
  isServiceErrorLike,
  sendServiceError,
  KNOWN_ERROR_CODES,
} from "@/services/errors";

function makeRes() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { res: { status } as never, status, json };
}

describe("ServiceError", () => {
  it("carries code + statusCode", () => {
    const e = new ServiceError("nope", "AGENT_NOT_FOUND", 404);
    expect(e.code).toBe("AGENT_NOT_FOUND");
    expect(e.statusCode).toBe(404);
    expect(e).toBeInstanceOf(Error);
  });

  it("accepts passthrough codes owned by other layers", () => {
    const e = new ServiceError("replayed", "PROOF_REPLAY", 409);
    expect(e.code).toBe("PROOF_REPLAY");
  });
});

describe("isServiceErrorLike", () => {
  it("is true for anything with string code + numeric statusCode", () => {
    expect(isServiceErrorLike({ code: "X", statusCode: 400 })).toBe(true);
    expect(isServiceErrorLike(new ServiceError("m", "INTERNAL_ERROR", 500))).toBe(true);
    expect(
      isServiceErrorLike(Object.assign(new Error("m"), { code: "OWNER_NOT_FOUND", statusCode: 404 })),
    ).toBe(true);
  });

  it("is false for a bare Error or a Prisma-style { code } without statusCode", () => {
    expect(isServiceErrorLike(new Error("boom"))).toBe(false);
    expect(isServiceErrorLike({ code: "P2002" })).toBe(false);
    expect(isServiceErrorLike(null)).toBe(false);
    expect(isServiceErrorLike("string")).toBe(false);
  });
});

describe("sendServiceError", () => {
  it("maps a service-like error to its status + { error, message } envelope", () => {
    const { res, status, json } = makeRes();
    sendServiceError(res, new ServiceError("missing scope", "AGENT_NOT_AUTHORIZED", 403));
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: "AGENT_NOT_AUTHORIZED", message: "missing scope" });
  });

  it("maps duck-typed (non-instance) service errors too", () => {
    const { res, status, json } = makeRes();
    sendServiceError(res, Object.assign(new Error("no owner"), { code: "OWNER_NOT_FOUND", statusCode: 404 }));
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: "OWNER_NOT_FOUND", message: "no owner" });
  });

  it("returns an opaque 500 and logs for an unexpected error", () => {
    const { res, status, json } = makeRes();
    const logger = { error: jest.fn() };
    sendServiceError(res, new Error("DB connection string leaked here"), logger);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: "INTERNAL_ERROR", message: "Internal error" });
    // the sensitive message is logged, never returned to the client
    expect(logger.error).toHaveBeenCalledWith(
      "unhandled_service_error",
      expect.objectContaining({ message: expect.stringContaining("leaked") }),
    );
  });
});

describe("KNOWN_ERROR_CODES", () => {
  it("includes the idempotency + core policy codes", () => {
    expect(KNOWN_ERROR_CODES).toEqual(expect.arrayContaining([
      "INVALID_IDEMPOTENCY_KEY", "POLICY_CONDITIONS_NOT_MET", "INTERNAL_ERROR",
    ]));
  });
});
