import { createHash } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT, type JWK } from "jose";
import {
  verifyPresentation,
  type PresentationVerifierDeps,
} from "@/services/oid4vp/verifier";
import { createJoseSdJwtDeps } from "@/services/oid4vp/sd-jwt-jose";
import { digestDisclosure, type SdJwtVerifyDeps } from "@/services/oid4vp/sd-jwt";

const POLICY_ID = "zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1";
const VCT = "https://credentials.zeroid/regulated-eligibility/v1";
const b64u = (s: string) => Buffer.from(s).toString("base64url");
const sha256b64u = (s: string) => createHash("sha256").update(s).digest("base64url");
let saltSeq = 0;
const objDisclosure = (name: string, value: unknown) =>
  b64u(JSON.stringify([`salt${saltSeq++}`, name, value]));

// ── Unit tests with stubbed signature verification ──────────────────────────

const NOW = 1_770_000_000;
function stubDeps(
  payload: Record<string, unknown>,
  kb: Record<string, unknown>,
  over: Partial<PresentationVerifierDeps> = {},
): PresentationVerifierDeps {
  const sdJwt: SdJwtVerifyDeps = {
    verifyIssuerJwt: jest.fn().mockResolvedValue({ payload }),
    verifyKeyBindingJwt: jest.fn().mockResolvedValue({ payload: kb }),
    now: () => NOW,
  };
  return { sdJwt, ...over };
}

const passingPayload = {
  vct: VCT,
  cnf: { jwk: { kty: "EC" } },
  age_equal_or_over: { "21": true },
  resident_country: "AE",
  nationalities: ["AE"],
  sanctions_status: "CLEAR",
  risk_tier: "LOW",
};
// compact "iss~kb" -> no disclosures -> presented prefix is "iss~"
const kbFor = (nonce: string, aud: string) => ({ nonce, aud, iat: NOW, sd_hash: sha256b64u("iss~") });

describe("verifyPresentation (stubbed signatures)", () => {
  it("ALLOWS when the verified claims satisfy the policy", async () => {
    const decision = await verifyPresentation(stubDeps(passingPayload, kbFor("n1", "rp")), {
      policyId: POLICY_ID, vpToken: "iss~kb", nonce: "n1", audience: "rp",
    });
    expect(decision.status).toBe("ALLOWED");
    expect(decision.policyId).toBe(POLICY_ID);
  });

  it("DENIES when a claim rule fails", async () => {
    const decision = await verifyPresentation(
      stubDeps({ ...passingPayload, risk_tier: "HIGH" }, kbFor("n1", "rp")),
      { policyId: POLICY_ID, vpToken: "iss~kb", nonce: "n1", audience: "rp" },
    );
    expect(decision.status).toBe("DENIED");
    expect(decision.reasons.join()).toContain("risk tier");
  });

  it("throws POLICY_NOT_FOUND for an unknown policy (before verifying)", async () => {
    await expect(
      verifyPresentation(stubDeps(passingPayload, kbFor("n1", "rp")), {
        policyId: "nope", vpToken: "iss~kb", nonce: "n1", audience: "rp",
      }),
    ).rejects.toMatchObject({ code: "POLICY_NOT_FOUND", statusCode: 404 });
  });

  it("rejects a replayed nonce when a consumeNonce guard is provided", async () => {
    const deps = stubDeps(passingPayload, kbFor("n1", "rp"), {
      consumeNonce: jest.fn().mockResolvedValue(false),
    });
    await expect(
      verifyPresentation(deps, { policyId: POLICY_ID, vpToken: "iss~kb", nonce: "n1", audience: "rp" }),
    ).rejects.toMatchObject({ code: "VP_NONCE_INVALID", statusCode: 401 });
  });
});

// ── Real-crypto round trip (jose): mint an SD-JWT VC + KB-JWT, verify it ──────

async function mintPresentation(opts: {
  nonce: string;
  aud: string;
  overrides?: Record<string, unknown>;
}): Promise<{ vpToken: string; issuerJwk: JWK }> {
  const issuer = await generateKeyPair("ES256");
  const holder = await generateKeyPair("ES256");
  const issuerJwk = await exportJWK(issuer.publicKey);
  const holderJwk = await exportJWK(holder.publicKey);

  const sdClaims: Record<string, unknown> = {
    resident_country: "AE",
    sanctions_status: "CLEAR",
    risk_tier: "LOW",
    ...opts.overrides,
  };
  const disclosures = Object.entries(sdClaims).map(([k, v]) => objDisclosure(k, v));
  const digests = disclosures.map(digestDisclosure);

  const issuerJwt = await new SignJWT({
    vct: VCT,
    iss: "https://issuer.zeroid",
    cnf: { jwk: holderJwk },
    _sd: digests,
    _sd_alg: "sha-256",
    age_equal_or_over: { "21": true }, // always-disclosed
    nationalities: ["AE"],
  })
    .setProtectedHeader({ alg: "ES256", typ: "dc+sd-jwt", kid: "issuer-1" })
    .setIssuedAt()
    .sign(issuer.privateKey);

  const prefix = issuerJwt + disclosures.map((d) => `~${d}`).join("") + "~";
  const kbJwt = await new SignJWT({ nonce: opts.nonce, aud: opts.aud, sd_hash: sha256b64u(prefix) })
    .setProtectedHeader({ alg: "ES256", typ: "kb+jwt" })
    .setIssuedAt()
    .sign(holder.privateKey);

  return { vpToken: prefix + kbJwt, issuerJwk };
}

describe("verifyPresentation (real jose crypto)", () => {
  it("ALLOWS a genuine SD-JWT VC presentation", async () => {
    const nonce = "nonce-123";
    const aud = "https://verifier.zeroid";
    const { vpToken, issuerJwk } = await mintPresentation({ nonce, aud });
    const deps: PresentationVerifierDeps = { sdJwt: createJoseSdJwtDeps(async () => issuerJwk) };

    const decision = await verifyPresentation(deps, { policyId: POLICY_ID, vpToken, nonce, audience: aud });
    expect(decision.status).toBe("ALLOWED");
    expect(decision.vct).toBe(VCT);
    expect(decision.disclosedClaims).toEqual(
      expect.arrayContaining(["resident_country", "sanctions_status", "risk_tier", "age_equal_or_over", "nationalities"]),
    );
  });

  it("DENIES a genuine presentation that fails policy (HIGH risk)", async () => {
    const { vpToken, issuerJwk } = await mintPresentation({ nonce: "n", aud: "a", overrides: { risk_tier: "HIGH" } });
    const deps: PresentationVerifierDeps = { sdJwt: createJoseSdJwtDeps(async () => issuerJwk) };
    const decision = await verifyPresentation(deps, { policyId: POLICY_ID, vpToken, nonce: "n", audience: "a" });
    expect(decision.status).toBe("DENIED");
    expect(decision.reasons.join()).toContain("risk tier");
  });

  it("rejects a presentation replayed to the wrong audience", async () => {
    const { vpToken, issuerJwk } = await mintPresentation({ nonce: "n", aud: "real-aud" });
    const deps: PresentationVerifierDeps = { sdJwt: createJoseSdJwtDeps(async () => issuerJwk) };
    await expect(
      verifyPresentation(deps, { policyId: POLICY_ID, vpToken, nonce: "n", audience: "WRONG-aud" }),
    ).rejects.toMatchObject({ code: "VP_TOKEN_INVALID" });
  });
});
