import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { createJoseZkDeps } from "@/services/oid4vp/zk-predicate-jose";
import { ZK_ELIGIBILITY_FORMAT } from "@/services/oid4vp/zk-predicate";

describe("createJoseZkDeps.verifyHolderJwt", () => {
  it("verifies a real ES256 envelope and returns header + payload", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const jwk = await exportJWK(publicKey);
    const jwt = await new SignJWT({ aud: "rp", nonce: "n1" })
      .setProtectedHeader({ alg: "ES256", typ: ZK_ELIGIBILITY_FORMAT, jwk })
      .setIssuedAt()
      .sign(privateKey);

    const { header, payload } = await createJoseZkDeps().verifyHolderJwt(jwt);
    expect(header.typ).toBe(ZK_ELIGIBILITY_FORMAT);
    expect(payload.nonce).toBe("n1");
  });

  it("rejects a tampered envelope", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const jwk = await exportJWK(publicKey);
    const jwt = await new SignJWT({ aud: "rp" })
      .setProtectedHeader({ alg: "ES256", typ: ZK_ELIGIBILITY_FORMAT, jwk })
      .sign(privateKey);
    await expect(createJoseZkDeps().verifyHolderJwt(jwt.slice(0, -3) + "AAA")).rejects.toMatchObject({
      code: "VP_TOKEN_INVALID",
    });
  });
});

describe("createJoseZkDeps.computeContextCommitment", () => {
  it("is deterministic and binds nonce + audience", async () => {
    const deps = createJoseZkDeps();
    const a = await deps.computeContextCommitment("n1", "rp");
    const b = await deps.computeContextCommitment("n1", "rp");
    const c = await deps.computeContextCommitment("n1", "other");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("createJoseZkDeps.verifyGroth16", () => {
  it("is gated (501) until a real verifier is injected (gate W2c)", async () => {
    await expect(
      createJoseZkDeps().verifyGroth16({ circuitId: "c", vkeyId: "v", proof: {}, publicSignals: {} }),
    ).rejects.toMatchObject({ statusCode: 501 });
  });

  it("delegates to an injected verifier when provided", async () => {
    const deps = createJoseZkDeps({ verifyGroth16: async () => true });
    await expect(
      deps.verifyGroth16({ circuitId: "c", vkeyId: "v", proof: {}, publicSignals: {} }),
    ).resolves.toBe(true);
  });
});
