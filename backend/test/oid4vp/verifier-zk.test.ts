import { verifyPresentation, type PresentationVerifierDeps } from "@/services/oid4vp/verifier";
import { ZK_ELIGIBILITY_FORMAT } from "@/services/oid4vp/zk-predicate";
import { getPresentationPolicy } from "@/services/oid4vp/policy-presentation";

const POLICY_ID = "zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1";
const POLICY = getPresentationPolicy(POLICY_ID);
const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const ZK_TOKEN = `${b64u({ typ: ZK_ELIGIBILITY_FORMAT, alg: "ES256" })}.${b64u({})}.sig`;

const VALID_SIGNALS: Record<string, string> = {
  ...POLICY.zk!.expectedPublicSignals,
  [POLICY.zk!.residency.signal]: "AE",
  [POLICY.zk!.contextSignal]: "0xctx",
  // The circuit evaluates its predicates at this instant; it must sit inside
  // the policy's freshness window around the verifier clock stubbed below.
  [POLICY.zk!.freshness.signal]: "1770000000",
};

function sdJwtDeps() {
  return { verifyIssuerJwt: jest.fn(), verifyKeyBindingJwt: jest.fn(), now: () => 1_770_000_000 };
}

function zkDeps(over: Record<string, unknown> = {}) {
  return {
    verifyHolderJwt: jest.fn(async () => ({
      header: { typ: ZK_ELIGIBILITY_FORMAT },
      payload: {
        aud: "rp", nonce: "n1", circuitId: POLICY.zk!.circuitId, vkeyId: POLICY.zk!.vkeyId,
        proof: {}, publicSignals: VALID_SIGNALS,
      },
    })),
    verifyGroth16: jest.fn(async () => true),
    computeContextCommitment: jest.fn(async () => "0xctx"),
    now: () => 1_770_000_000,
    ...over,
  };
}

const req = { policyId: POLICY_ID, vpToken: ZK_TOKEN, nonce: "n1", audience: "rp" };

describe("verifyPresentation — ZK predicate routing", () => {
  it("routes a ZK token to the ZK path and ALLOWS with zero disclosed claims", async () => {
    const deps: PresentationVerifierDeps = { sdJwt: sdJwtDeps(), zk: zkDeps() };
    const decision = await verifyPresentation(deps, req);
    expect(decision.status).toBe("ALLOWED");
    expect(decision.disclosedClaims).toEqual([]);
    expect(decision.vct).toBe(ZK_ELIGIBILITY_FORMAT);
  });

  it("DENIES when the ZK proof does not verify", async () => {
    const deps: PresentationVerifierDeps = {
      sdJwt: sdJwtDeps(),
      zk: zkDeps({ verifyGroth16: jest.fn(async () => false) }),
    };
    expect((await verifyPresentation(deps, req)).status).toBe("DENIED");
  });

  it("throws when a ZK token is presented but no ZK deps are configured", async () => {
    const deps: PresentationVerifierDeps = { sdJwt: sdJwtDeps() };
    await expect(verifyPresentation(deps, req)).rejects.toMatchObject({ code: "VP_TOKEN_INVALID" });
  });

  it("still honors consumeNonce before ZK verification", async () => {
    const consumeNonce = jest.fn(async () => false);
    const deps: PresentationVerifierDeps = { sdJwt: sdJwtDeps(), zk: zkDeps(), consumeNonce };
    await expect(verifyPresentation(deps, req)).rejects.toMatchObject({ code: "VP_NONCE_INVALID" });
    expect(consumeNonce).toHaveBeenCalledWith("n1");
  });
});
