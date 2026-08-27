import { generateKeyPairSync } from "node:crypto";
import { createIssuerSignDepsFromEnv } from "@/services/oid4vci/issuer-key";

const ecPair = generateKeyPairSync("ec", { namedCurve: "P-256" });
const privateJwk = { ...ecPair.privateKey.export({ format: "jwk" }), kid: "issuer-key-1" };

describe("createIssuerSignDepsFromEnv", () => {
  it("PRODUCTION + missing OID4VCI_ISSUER_JWK -> throws (503), never an ephemeral key", async () => {
    await expect(
      createIssuerSignDepsFromEnv({ NODE_ENV: "production" }),
    ).rejects.toMatchObject({ code: "OID4VCI_ISSUER_KEY_REQUIRED", statusCode: 503 });
  });

  it("PRODUCTION + malformed OID4VCI_ISSUER_JWK -> throws (503)", async () => {
    await expect(
      createIssuerSignDepsFromEnv({ NODE_ENV: "production", OID4VCI_ISSUER_JWK: "not-json" }),
    ).rejects.toMatchObject({ code: "OID4VCI_ISSUER_KEY_REQUIRED", statusCode: 503 });
  });

  it("uses the configured key and surfaces its kid in the JWS header", async () => {
    const deps = await createIssuerSignDepsFromEnv({
      NODE_ENV: "production",
      OID4VCI_ISSUER_JWK: JSON.stringify(privateJwk),
    });
    const jwt = await deps.signIssuerJwt({ iss: "x" }, { alg: "ES256", typ: "dc+sd-jwt" });
    const header = JSON.parse(Buffer.from(jwt.split(".")[0], "base64url").toString("utf8"));
    expect(header.kid).toBe("issuer-key-1");
    expect(jwt.split(".")).toHaveLength(3);
  });

  it("DEV + missing key -> ephemeral fallback with a warning (unchanged dev UX)", async () => {
    const warn = jest.fn();
    const deps = await createIssuerSignDepsFromEnv({ NODE_ENV: "test" }, { warn });
    const jwt = await deps.signIssuerJwt({ iss: "x" }, { alg: "ES256" });
    expect(jwt.split(".")).toHaveLength(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ephemeral"));
  });
});
