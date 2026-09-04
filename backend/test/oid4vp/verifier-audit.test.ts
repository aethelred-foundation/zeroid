import { verifyPresentation, type PresentationVerifierDeps } from "@/services/oid4vp/verifier";
import { ZK_ELIGIBILITY_FORMAT } from "@/services/oid4vp/zk-predicate";
import { getPresentationPolicy } from "@/services/oid4vp/policy-presentation";

const POLICY_ID = "zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1";
const POLICY = getPresentationPolicy(POLICY_ID);
const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const ZK_TOKEN = `${b64u({ typ: ZK_ELIGIBILITY_FORMAT, alg: "ES256" })}.${b64u({})}.sig`;
const VALID: Record<string, string> = {
  ...POLICY.zk!.expectedPublicSignals,
  [POLICY.zk!.residency.signal]: "AE",
  [POLICY.zk!.contextSignal]: "0xctx",
  // Matches the stubbed verifier clock (`now: () => 0`) so the proof is fresh.
  [POLICY.zk!.freshness.signal]: "0",
};

const sdJwtDeps = () => ({ verifyIssuerJwt: jest.fn(), verifyKeyBindingJwt: jest.fn(), now: () => 0 });
function zkDeps(over: Record<string, unknown> = {}) {
  return {
    verifyHolderJwt: jest.fn(async () => ({
      header: { typ: ZK_ELIGIBILITY_FORMAT },
      payload: {
        aud: "rp", nonce: "n1", circuitId: POLICY.zk!.circuitId, vkeyId: POLICY.zk!.vkeyId,
        proof: {}, publicSignals: VALID,
      },
    })),
    verifyGroth16: jest.fn(async () => true),
    computeContextCommitment: jest.fn(async () => "0xctx"),
    declaredPublicSignals: jest.fn(() => Object.keys(VALID)),
    now: () => 0,
    ...over,
  };
}
const req = { policyId: POLICY_ID, vpToken: ZK_TOKEN, nonce: "n1", audience: "rp" };

describe("verifyPresentation — audit recording hook", () => {
  it("records the decision after a successful verification", async () => {
    const recordDecision = jest.fn().mockResolvedValue(undefined);
    const deps: PresentationVerifierDeps = { sdJwt: sdJwtDeps(), zk: zkDeps(), recordDecision };
    const decision = await verifyPresentation(deps, req);
    expect(recordDecision).toHaveBeenCalledWith(decision);
  });

  it("records DENIED decisions too", async () => {
    const recordDecision = jest.fn().mockResolvedValue(undefined);
    await verifyPresentation(
      { sdJwt: sdJwtDeps(), zk: zkDeps({ verifyGroth16: jest.fn(async () => false) }), recordDecision },
      req,
    );
    expect(recordDecision).toHaveBeenCalledWith(expect.objectContaining({ status: "DENIED" }));
  });

  it("is a no-op when no recorder is configured", async () => {
    const decision = await verifyPresentation({ sdJwt: sdJwtDeps(), zk: zkDeps() }, req);
    expect(decision.status).toBe("ALLOWED");
  });

  it("fails closed when the audit write fails (no un-recorded decision)", async () => {
    const recordDecision = jest.fn().mockRejectedValue(new Error("audit db down"));
    await expect(
      verifyPresentation({ sdJwt: sdJwtDeps(), zk: zkDeps(), recordDecision }, req),
    ).rejects.toThrow(/audit/i);
  });
});
