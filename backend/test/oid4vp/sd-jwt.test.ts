import { createHash } from "node:crypto";
import {
  parseSdJwt,
  decodeDisclosure,
  digestDisclosure,
  reconstructClaims,
  verifySdJwtVc,
  type SdJwtVerifyDeps,
} from "@/services/oid4vp/sd-jwt";

const b64u = (s: string) => Buffer.from(s).toString("base64url");
const objDisclosure = (name: string, value: unknown, salt = "salt") =>
  b64u(JSON.stringify([salt, name, value]));
const arrDisclosure = (value: unknown, salt = "salt") => b64u(JSON.stringify([salt, value]));
const sha256b64u = (s: string) => createHash("sha256").update(s).digest("base64url");

describe("parseSdJwt", () => {
  it("splits issuer JWT, disclosures, and optional KB-JWT", () => {
    expect(parseSdJwt("J~d1~d2~KB")).toEqual({ jwt: "J", disclosures: ["d1", "d2"], keyBindingJwt: "KB" });
    expect(parseSdJwt("J~d1~")).toEqual({ jwt: "J", disclosures: ["d1"], keyBindingJwt: null });
    expect(parseSdJwt("J~KB")).toEqual({ jwt: "J", disclosures: [], keyBindingJwt: "KB" });
    expect(parseSdJwt("J")).toEqual({ jwt: "J", disclosures: [], keyBindingJwt: null });
  });
});

describe("decodeDisclosure", () => {
  it("decodes object-property (3) and array-element (2) disclosures", () => {
    expect(decodeDisclosure(objDisclosure("resident_country", "AE"))).toEqual({
      salt: "salt", name: "resident_country", value: "AE",
    });
    expect(decodeDisclosure(arrDisclosure("AE"))).toEqual({ salt: "salt", value: "AE" });
  });

  it("rejects a malformed disclosure", () => {
    expect(() => decodeDisclosure(b64u(JSON.stringify(["only-salt"])))).toThrow(
      expect.objectContaining({ code: "VP_TOKEN_INVALID" }),
    );
  });
});

describe("digestDisclosure", () => {
  it("is the base64url SHA-256 of the disclosure string", () => {
    const d = objDisclosure("risk_tier", "LOW");
    expect(digestDisclosure(d)).toBe(sha256b64u(d));
  });
});

describe("reconstructClaims", () => {
  it("reveals disclosed object claims and omits undisclosed ones", () => {
    const shown = objDisclosure("resident_country", "AE");
    const hidden = objDisclosure("risk_tier", "LOW");
    const payload = {
      vct: "x",
      _sd: [digestDisclosure(shown), digestDisclosure(hidden)],
      _sd_alg: "sha-256",
    };
    const claims = reconstructClaims(payload, [shown]); // only disclose residency
    expect(claims.resident_country).toBe("AE");
    expect(claims.risk_tier).toBeUndefined();
    expect(claims).not.toHaveProperty("_sd");
  });

  it("reconstructs array-element disclosures", () => {
    const d = arrDisclosure("AE");
    const payload = { nationalities: [{ "...": digestDisclosure(d) }, "US"] };
    expect(reconstructClaims(payload, [d]).nationalities).toEqual(["AE", "US"]);
  });

  it("throws when a provided disclosure is unreferenced by any digest", () => {
    const payload = { _sd: [] as string[] };
    expect(() => reconstructClaims(payload, [objDisclosure("x", 1)])).toThrow(
      expect.objectContaining({ code: "VP_TOKEN_INVALID" }),
    );
  });
});

describe("verifySdJwtVc", () => {
  const NOW = 1_770_000_000;
  function deps(payload: Record<string, unknown>, kb: Record<string, unknown>): SdJwtVerifyDeps {
    return {
      verifyIssuerJwt: jest.fn().mockResolvedValue({ payload }),
      verifyKeyBindingJwt: jest.fn().mockResolvedValue({ payload: kb }),
      now: () => NOW,
    };
  }

  it("verifies issuer sig + disclosures + holder binding (happy path)", async () => {
    const disc = objDisclosure("resident_country", "AE");
    const compact = `iss~${disc}~kb`;
    const sdHash = sha256b64u(`iss~${disc}~`);
    const payload = { vct: "vct-x", _sd: [digestDisclosure(disc)], cnf: { jwk: { kty: "EC" } } };
    const kb = { nonce: "n1", aud: "rp", iat: NOW, sd_hash: sdHash };

    const out = await verifySdJwtVc(deps(payload, kb), {
      compact, expectedNonce: "n1", expectedAudience: "rp", expectedVct: "vct-x",
    });
    expect(out.vct).toBe("vct-x");
    expect(out.claims.resident_country).toBe("AE");
  });

  it("rejects a vct mismatch", async () => {
    await expect(
      verifySdJwtVc(deps({ vct: "other", cnf: { jwk: {} } }, {}), {
        compact: "iss~kb", expectedNonce: "n", expectedAudience: "rp", expectedVct: "vct-x",
      }),
    ).rejects.toMatchObject({ code: "VP_VCT_MISMATCH" });
  });

  it("rejects a key-binding nonce mismatch", async () => {
    const payload = { vct: "vct-x", cnf: { jwk: { kty: "EC" } } };
    const kb = { nonce: "WRONG", aud: "rp", iat: NOW, sd_hash: "x" };
    await expect(
      verifySdJwtVc(deps(payload, kb), {
        compact: "iss~kb", expectedNonce: "n1", expectedAudience: "rp", expectedVct: "vct-x",
      }),
    ).rejects.toMatchObject({ code: "VP_NONCE_INVALID" });
  });

  it("rejects when key binding is required but absent", async () => {
    const payload = { vct: "vct-x", cnf: { jwk: {} } };
    await expect(
      verifySdJwtVc(deps(payload, {}), {
        compact: "iss~", expectedNonce: "n", expectedAudience: "rp", expectedVct: "vct-x",
      }),
    ).rejects.toMatchObject({ code: "VP_TOKEN_INVALID" });
  });
});
