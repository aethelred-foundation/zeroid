import { createHash, randomBytes } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import {
  createPresentationRequest,
  getRequestObject,
  handleCallback,
  getResult,
  createInMemoryOid4vpRequestStore,
  type CrossDeviceDeps,
} from "@/services/oid4vp/cross-device";
import { createJoseSdJwtDeps } from "@/services/oid4vp/sd-jwt-jose";
import { digestDisclosure } from "@/services/oid4vp/sd-jwt";
import { ZK_ELIGIBILITY_FORMAT } from "@/services/oid4vp/zk-predicate";
import { getPresentationPolicy } from "@/services/oid4vp/policy-presentation";

const POLICY_ID = "zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1";
const VCT = "https://credentials.zeroid/regulated-eligibility/v1";
const b64u = (s: string) => Buffer.from(s).toString("base64url");
const sha256b64u = (s: string) => createHash("sha256").update(s).digest("base64url");
let salt = 0;

function makeDeps(over: Partial<CrossDeviceDeps> = {}): CrossDeviceDeps {
  let i = 0;
  return {
    store: createInMemoryOid4vpRequestStore(),
    verifier: { sdJwt: { verifyIssuerJwt: jest.fn(), verifyKeyBindingJwt: jest.fn(), now: () => 0 } },
    genId: () => `id-${i++}`,
    now: () => Math.floor(Date.now() / 1000),
    baseUrl: "https://verifier.zeroid",
    ...over,
  };
}

describe("cross-device request lifecycle (in-memory)", () => {
  it("creates a persisted request with a request_uri + DCQL", async () => {
    const deps = makeDeps();
    const r = await createPresentationRequest(deps, { policyId: POLICY_ID, audience: "rp" });
    expect(r.state).toBe("id-0");
    expect(r.nonce).toBe("id-1");
    expect(r.request_uri).toBe("https://verifier.zeroid/api/v1/oid4vp/request/id-0");
    expect(r.dcql_query.credentials[0].meta.vct_values).toEqual([VCT]);
    const obj = await getRequestObject(deps, "id-0");
    expect(obj.response_uri).toBe("https://verifier.zeroid/api/v1/oid4vp/callback");
    expect(obj.nonce).toBe("id-1");
  });

  it("rejects an unknown policy and a missing request", async () => {
    const deps = makeDeps();
    await expect(createPresentationRequest(deps, { policyId: "nope", audience: "rp" })).rejects.toMatchObject({
      code: "POLICY_NOT_FOUND",
    });
    await expect(getRequestObject(deps, "missing")).rejects.toMatchObject({ statusCode: 404 });
    await expect(getResult(deps, "missing")).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ── Real-crypto cross-device round trip ─────────────────────────────────────

async function mintPresentation(opts: {
  issuerPriv: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
  holderPriv: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
  holderPubJwk: Record<string, unknown>;
  nonce: string;
  aud: string;
  overrides?: Record<string, unknown>;
}): Promise<string> {
  const sdClaims: Record<string, unknown> = {
    resident_country: "AE",
    sanctions_status: "CLEAR",
    risk_tier: "LOW",
    ...opts.overrides,
  };
  const disclosures = Object.entries(sdClaims).map(([k, v]) => b64u(JSON.stringify([`s${salt++}`, k, v])));
  const issuerJwt = await new SignJWT({
    vct: VCT,
    iss: "https://issuer.zeroid",
    cnf: { jwk: opts.holderPubJwk },
    _sd: disclosures.map(digestDisclosure),
    _sd_alg: "sha-256",
    age_equal_or_over: { "21": true },
    nationalities: ["AE"],
  })
    .setProtectedHeader({ alg: "ES256", typ: "dc+sd-jwt" })
    .setIssuedAt()
    .sign(opts.issuerPriv);
  const prefix = issuerJwt + disclosures.map((d) => `~${d}`).join("") + "~";
  const kbJwt = await new SignJWT({ nonce: opts.nonce, aud: opts.aud, sd_hash: sha256b64u(prefix) })
    .setProtectedHeader({ alg: "ES256", typ: "kb+jwt" })
    .setIssuedAt()
    .sign(opts.holderPriv);
  return prefix + kbJwt;
}

describe("cross-device round trip (real jose)", () => {
  it("authorize -> callback -> result, with one-time nonce consumption", async () => {
    const issuer = await generateKeyPair("ES256");
    const holder = await generateKeyPair("ES256");
    const issuerPubJwk = await exportJWK(issuer.publicKey);
    const holderPubJwk = await exportJWK(holder.publicKey);

    const deps = makeDeps({
      verifier: { sdJwt: createJoseSdJwtDeps(async () => issuerPubJwk) },
      genId: (() => {
        let i = 0;
        return () => `cd-${i++}-${randomBytes(4).toString("hex")}`;
      })(),
    });
    const aud = "https://verifier.zeroid";

    // 1. relying party authorizes
    const authz = await createPresentationRequest(deps, { policyId: POLICY_ID, audience: aud });
    // result is pending before any callback
    expect((await getResult(deps, authz.state)).status).toBe("PENDING");

    // 2. wallet presents
    const vpToken = await mintPresentation({
      issuerPriv: issuer.privateKey,
      holderPriv: holder.privateKey,
      holderPubJwk,
      nonce: authz.nonce,
      aud,
    });
    const decision = await handleCallback(deps, { state: authz.state, vpToken });
    expect(decision.status).toBe("ALLOWED");

    // 3. initiating device polls the result
    const result = await getResult(deps, authz.state);
    expect(result.status).toBe("COMPLETED");
    expect(result.decision?.status).toBe("ALLOWED");

    // 4. replay of the same request is rejected (nonce already consumed)
    await expect(handleCallback(deps, { state: authz.state, vpToken })).rejects.toMatchObject({
      code: "VP_NONCE_INVALID",
    });
  });
});

describe("cross-device ZK predicate routing", () => {
  it("forwards ZK deps so a zeroid-zk-eligibility token is ALLOWED with zero disclosure", async () => {
    const policy = getPresentationPolicy(POLICY_ID);
    const aud = "https://verifier.zeroid";
    const VALID: Record<string, string> = {
      ...policy.zk!.expectedPublicSignals,
      [policy.zk!.residency.signal]: "AE",
      [policy.zk!.contextSignal]: "0xctx",
      // Matches the stubbed verifier clock (`now: () => 0`) so the proof is fresh.
      [policy.zk!.freshness.signal]: "0",
    };
    let issuedNonce = "";
    const zk = {
      verifyHolderJwt: jest.fn(async () => ({
        header: { typ: ZK_ELIGIBILITY_FORMAT },
        payload: {
          aud, nonce: issuedNonce, circuitId: policy.zk!.circuitId, vkeyId: policy.zk!.vkeyId,
          proof: {}, publicSignals: VALID,
        },
      })),
      verifyGroth16: jest.fn(async () => true),
      computeContextCommitment: jest.fn(async () => "0xctx"),
      declaredPublicSignals: jest.fn(() => Object.keys(VALID)),
      now: () => 0,
    };
    const recordDecision = jest.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      verifier: {
        sdJwt: { verifyIssuerJwt: jest.fn(), verifyKeyBindingJwt: jest.fn(), now: () => 0 },
        zk,
        recordDecision,
      },
    });

    const authz = await createPresentationRequest(deps, { policyId: POLICY_ID, audience: aud });
    issuedNonce = authz.nonce;
    const zkToken = `${b64u(JSON.stringify({ typ: ZK_ELIGIBILITY_FORMAT, alg: "ES256" }))}.${b64u("{}")}.sig`;

    const decision = await handleCallback(deps, { state: authz.state, vpToken: zkToken });
    expect(decision.status).toBe("ALLOWED");
    expect(decision.disclosedClaims).toEqual([]);
    // the cross-device callback must forward the audit hook to the verifier
    expect(recordDecision).toHaveBeenCalledWith(decision);
  });
});
