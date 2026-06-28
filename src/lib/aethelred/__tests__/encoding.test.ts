import {
  fieldElementToBytes,
  toBase64,
  encodePublicInput,
  serializeGroth16ProofUncompressed,
} from "@/lib/aethelred/encoding";

describe("fieldElementToBytes", () => {
  it("encodes 0 as 32 zero bytes", () => {
    const b = fieldElementToBytes("0");
    expect(b.length).toBe(32);
    expect(Array.from(b).every((x) => x === 0)).toBe(true);
  });
  it("encodes 1 big-endian (last byte set)", () => {
    const b = fieldElementToBytes("1");
    expect(b[31]).toBe(1);
    expect(b[30]).toBe(0);
  });
  it("encodes 256 across two bytes big-endian", () => {
    const b = fieldElementToBytes("256");
    expect(b[31]).toBe(0);
    expect(b[30]).toBe(1);
  });
  it("throws if the value exceeds 32 bytes", () => {
    const tooBig = (2n ** 256n).toString();
    expect(() => fieldElementToBytes(tooBig)).toThrow();
  });
});

describe("toBase64 / encodePublicInput", () => {
  it("round-trips bytes through base64", () => {
    const bytes = fieldElementToBytes("123456789");
    const b64 = toBase64(bytes);
    expect(Buffer.from(b64, "base64").equals(Buffer.from(bytes))).toBe(true);
  });
  it("encodes a public input as base64 of a 32-byte field element", () => {
    const decoded = Buffer.from(encodePublicInput("1"), "base64");
    expect(decoded.length).toBe(32);
    expect(decoded[31]).toBe(1);
  });
});

describe("serializeGroth16ProofUncompressed", () => {
  it("produces 256 bytes (G1 + G2 + G1) of base64", () => {
    const proof = {
      a: ["1", "2"] as [string, string],
      b: [
        ["3", "4"],
        ["5", "6"],
      ] as [[string, string], [string, string]],
      c: ["7", "8"] as [string, string],
    };
    const decoded = Buffer.from(
      serializeGroth16ProofUncompressed(proof),
      "base64",
    );
    expect(decoded.length).toBe(256);
    expect(decoded[31]).toBe(1); // a[0]
    expect(decoded[63]).toBe(2); // a[1]
    expect(decoded[255]).toBe(8); // c[1]
  });
});
