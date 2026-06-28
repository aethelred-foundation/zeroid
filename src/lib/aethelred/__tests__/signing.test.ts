import {
  isPqcSigningEnabled,
  signHybrid,
  configurePQCProvider,
} from "@/lib/aethelred/signing";
import { toHex, type PQCProvider } from "@aethelred/sdk/crypto";

const SIG_BYTES = new Uint8Array([0xaa, 0xbb, 0xcc]);

function makeFakeProvider(signSpy: jest.Mock): PQCProvider {
  const notImpl = async () => {
    throw new Error("not implemented in fake");
  };
  return {
    kemKeypair: notImpl as never,
    encapsulate: notImpl as never,
    decapsulate: notImpl as never,
    signKeypair: notImpl as never,
    sign: signSpy as never,
    verify: notImpl as never,
  };
}

const ENV = process.env;
afterEach(() => {
  process.env = ENV;
  configurePQCProvider(null);
  jest.clearAllMocks();
});
beforeEach(() => {
  process.env = { ...ENV };
});

describe("signHybrid", () => {
  it("returns a hybrid envelope when enabled, provider configured, and key present", async () => {
    process.env.NEXT_PUBLIC_PQC_SIGNING = "true";
    const sign = jest.fn().mockResolvedValue(SIG_BYTES);
    configurePQCProvider(makeFakeProvider(sign));

    const msg = new Uint8Array([1, 2, 3]);
    const sk = new Uint8Array(32);
    const result = await signHybrid(msg, "0xecdsa", sk);

    expect(sign).toHaveBeenCalledWith(msg, sk, "ML-DSA-65");
    expect(result.scheme).toBe("hybrid-mldsa65-ecdsa");
    expect(result.classical).toBe("0xecdsa");
    expect(result.pqc).toBe(toHex(SIG_BYTES));
  });

  it("returns classical-only when the flag is off", async () => {
    delete process.env.NEXT_PUBLIC_PQC_SIGNING;
    expect(isPqcSigningEnabled()).toBe(false);
    const result = await signHybrid(new Uint8Array([1]), "0xecdsa", new Uint8Array(32));
    expect(result.scheme).toBe("ecdsa");
    expect(result.pqc).toBeUndefined();
  });

  it("falls back to classical when enabled but no provider is configured", async () => {
    process.env.NEXT_PUBLIC_PQC_SIGNING = "true";
    configurePQCProvider(null);
    const result = await signHybrid(new Uint8Array([1]), "0xecdsa", new Uint8Array(32));
    expect(result.scheme).toBe("ecdsa");
  });

  it("falls back to classical when enabled and provider set but no key", async () => {
    process.env.NEXT_PUBLIC_PQC_SIGNING = "true";
    const sign = jest.fn();
    configurePQCProvider(makeFakeProvider(sign));
    const result = await signHybrid(new Uint8Array([1]), "0xecdsa");
    expect(result.scheme).toBe("ecdsa");
    expect(sign).not.toHaveBeenCalled();
  });
});
