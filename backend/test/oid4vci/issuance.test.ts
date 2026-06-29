import { createHash, randomBytes } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import {
  createCredentialOffer,
  redeemPreAuthorizedCode,
  issueCredential,
  createInMemoryIssuanceStores,
  buildIssuerMetadata,
  PRE_AUTH_GRANT_TYPE,
  type IssuanceDeps,
} from "@/services/oid4vci/issuance";
import { createJoseIssuanceSignDeps, createJoseKeyProofVerifier } from "@/services/oid4vci/jose";
import { verifyPresentation } from "@/services/oid4vp/verifier";
import { createJoseSdJwtDeps } from "@/services/oid4vp/sd-jwt-jose";

const ISSUER = "https://issuer.zeroid";
const NOW = 1_770_000_000;
const ATTRS = {
  resident_country: "AE",
  sanctions_status: "CLEAR",
  risk_tier: "LOW",
  age_equal_or_over: { "21": true },
  nationalities: ["AE"],
};

function unitDeps(over: Partial<IssuanceDeps> = {}): IssuanceDeps {
  let i = 0;
  return {
    issuer: ISSUER,
    stores: createInMemoryIssuanceStores(),
    sourceClaims: jest.fn().mockResolvedValue({ ...ATTRS }),
    sign: { signIssuerJwt: jest.fn().mockResolvedValue("J"), genSalt: () => "s", now: () => NOW },
    verifyKeyProof: jest.fn().mockResolvedValue({ holderJwk: { kty: "EC" } }),
    genId: () => `id${i++}`,
    now: () => NOW,
    ...over,
  };
}

describe("buildIssuerMetadata", () => {
  it("advertises the issuer endpoints + supported configurations", () => {
    const md = buildIssuerMetadata(ISSUER);
    expect(md.credential_issuer).toBe(ISSUER);
    expect(md.credential_endpoint).toBe(`${ISSUER}/credential`);
    expect(md.credential_configurations_supported).toHaveProperty("regulated-eligibility-v1");
  });
});

describe("createCredentialOffer", () => {
  it("mints a pre-authorized offer for a known configuration", async () => {
    const deps = unitDeps();
    const { offer, preAuthorizedCode } = await createCredentialOffer(deps, {
      configId: "regulated-eligibility-v1", subjectDid: "did:z:alice",
    });
    expect(offer.credential_configuration_ids).toEqual(["regulated-eligibility-v1"]);
    expect(offer.grants[PRE_AUTH_GRANT_TYPE]["pre-authorized_code"]).toBe(preAuthorizedCode);
  });

  it("rejects an unknown configuration", async () => {
    await expect(
      createCredentialOffer(unitDeps(), { configId: "nope", subjectDid: "did:z:alice" }),
    ).rejects.toMatchObject({ code: "unsupported_credential_type", statusCode: 400 });
  });
});

describe("redeemPreAuthorizedCode", () => {
  it("rejects an unsupported grant_type", async () => {
    await expect(
      redeemPreAuthorizedCode(unitDeps(), { grantType: "authorization_code", preAuthorizedCode: "x" }),
    ).rejects.toMatchObject({ code: "unsupported_grant_type" });
  });

  it("rejects an unknown code with invalid_grant", async () => {
    await expect(
      redeemPreAuthorizedCode(unitDeps(), { grantType: PRE_AUTH_GRANT_TYPE, preAuthorizedCode: "missing" }),
    ).rejects.toMatchObject({ code: "invalid_grant", statusCode: 400 });
  });

  it("enforces the tx_code", async () => {
    const deps = unitDeps();
    const { preAuthorizedCode } = await createCredentialOffer(deps, {
      configId: "regulated-eligibility-v1", subjectDid: "did:z:alice", txCode: "1234",
    });
    await expect(
      redeemPreAuthorizedCode(deps, { grantType: PRE_AUTH_GRANT_TYPE, preAuthorizedCode, txCode: "9999" }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });
});

describe("issueCredential", () => {
  it("rejects an invalid access token", async () => {
    await expect(
      issueCredential(unitDeps(), { accessToken: "nope", proofJwt: "x" }),
    ).rejects.toMatchObject({ code: "invalid_token", statusCode: 401 });
  });

  it("issues from offer -> token -> credential (stubbed signer)", async () => {
    const deps = unitDeps();
    const { preAuthorizedCode } = await createCredentialOffer(deps, {
      configId: "regulated-eligibility-v1", subjectDid: "did:z:alice",
    });
    const tok = await redeemPreAuthorizedCode(deps, { grantType: PRE_AUTH_GRANT_TYPE, preAuthorizedCode });
    const cred = await issueCredential(deps, { accessToken: tok.access_token, proofJwt: "proof" });
    expect(cred.format).toBe("dc+sd-jwt");
    expect(deps.verifyKeyProof).toHaveBeenCalledWith("proof", { aud: ISSUER, nonce: tok.c_nonce });
  });
});

describe("full OID4VCI issue -> present -> verify (real jose crypto)", () => {
  it("issues an SD-JWT VC that the OpenID4VP verifier ALLOWS", async () => {
    const issuer = await generateKeyPair("ES256");
    const holder = await generateKeyPair("ES256");
    const issuerPubJwk = await exportJWK(issuer.publicKey);
    const holderPubJwk = await exportJWK(holder.publicKey);

    const deps: IssuanceDeps = {
      issuer: ISSUER,
      stores: createInMemoryIssuanceStores(),
      sourceClaims: async () => ({ ...ATTRS }),
      sign: createJoseIssuanceSignDeps({ privateKey: issuer.privateKey }),
      verifyKeyProof: createJoseKeyProofVerifier(),
      genId: () => randomBytes(24).toString("base64url"),
      now: () => Math.floor(Date.now() / 1000),
    };

    // 1. offer  2. token
    const { preAuthorizedCode } = await createCredentialOffer(deps, {
      configId: "regulated-eligibility-v1", subjectDid: "did:z:alice",
    });
    const tok = await redeemPreAuthorizedCode(deps, { grantType: PRE_AUTH_GRANT_TYPE, preAuthorizedCode });

    // 3. holder proof of possession over the c_nonce
    const proofJwt = await new SignJWT({ aud: ISSUER, nonce: tok.c_nonce })
      .setProtectedHeader({ alg: "ES256", typ: "openid4vci-proof+jwt", jwk: holderPubJwk })
      .setIssuedAt()
      .sign(holder.privateKey);

    // 4. issue the credential
    const { credential, format } = await issueCredential(deps, {
      accessToken: tok.access_token,
      proofJwt,
    });
    expect(format).toBe("dc+sd-jwt");

    // 5. holder presents it: build a KB-JWT over the issued credential
    const sha256b64u = (s: string) => createHash("sha256").update(s).digest("base64url");
    const nonce = "verify-nonce";
    const aud = "https://verifier.zeroid";
    const kbJwt = await new SignJWT({ nonce, aud, sd_hash: sha256b64u(credential) })
      .setProtectedHeader({ alg: "ES256", typ: "kb+jwt" })
      .setIssuedAt()
      .sign(holder.privateKey);
    const vpToken = credential + kbJwt;

    // 6. verify through the OpenID4VP verifier
    const decision = await verifyPresentation(
      { sdJwt: createJoseSdJwtDeps(async () => issuerPubJwk) },
      {
        policyId: "zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1",
        vpToken,
        nonce,
        audience: aud,
      },
    );
    expect(decision.status).toBe("ALLOWED");
    expect(decision.disclosedClaims).toEqual(
      expect.arrayContaining(["resident_country", "sanctions_status", "risk_tier"]),
    );
  });
});
