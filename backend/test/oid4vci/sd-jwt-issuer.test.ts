import { issueSdJwtVc, type SdJwtIssueDeps } from "@/services/oid4vci/sd-jwt-issuer";
import { parseSdJwt, reconstructClaims, digestDisclosure } from "@/services/oid4vp/sd-jwt";

function stubDeps(): SdJwtIssueDeps {
  let n = 0;
  return {
    // Fake JWS whose middle segment is the base64url payload, so tests can decode it.
    signIssuerJwt: jest.fn(async (payload) => `eyJ.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`),
    genSalt: () => `salt${n++}`,
    now: () => 1_770_000_000,
  };
}

function payloadOf(jwt: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
}

describe("issueSdJwtVc", () => {
  it("builds an SD-JWT VC with _sd digests, cnf, plain claims, and trailing '~' (no KB)", async () => {
    const { credential, disclosures } = await issueSdJwtVc(stubDeps(), {
      vct: "https://credentials.zeroid/regulated-eligibility/v1",
      issuer: "https://issuer.zeroid",
      holderJwk: { kty: "EC", crv: "P-256" },
      claims: { age_equal_or_over: { "21": true } },
      sdClaims: { resident_country: "AE", risk_tier: "LOW" },
    });

    expect(credential.endsWith("~")).toBe(true);
    expect(disclosures).toHaveLength(2);

    const { jwt, disclosures: parsed, keyBindingJwt } = parseSdJwt(credential);
    expect(keyBindingJwt).toBeNull();
    expect(parsed).toEqual(disclosures);

    const payload = payloadOf(jwt);
    expect(payload.vct).toBe("https://credentials.zeroid/regulated-eligibility/v1");
    expect(payload.cnf).toEqual({ jwk: { kty: "EC", crv: "P-256" } });
    expect(payload.age_equal_or_over).toEqual({ "21": true }); // plain
    expect(payload._sd_alg).toBe("sha-256");
    expect(payload._sd).toEqual(disclosures.map(digestDisclosure).sort());
  });

  it("round-trips: issued disclosures reconstruct to the original sd claims", async () => {
    const { credential } = await issueSdJwtVc(stubDeps(), {
      vct: "vct-x",
      issuer: "iss",
      holderJwk: { kty: "EC" },
      sdClaims: { resident_country: "AE", sanctions_status: "CLEAR" },
    });
    const { jwt, disclosures } = parseSdJwt(credential);
    const claims = reconstructClaims(payloadOf(jwt), disclosures);
    expect(claims.resident_country).toBe("AE");
    expect(claims.sanctions_status).toBe("CLEAR");
    expect(claims).not.toHaveProperty("_sd");
  });
});
