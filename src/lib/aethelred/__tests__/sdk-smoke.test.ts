import { VERSION, createAethelredClient } from "@aethelred/sdk";

describe("@aethelred/sdk dependency", () => {
  it("resolves the canonical SDK at v1.0.0", () => {
    expect(VERSION).toBe("1.0.0");
  });
  it("exposes a client factory", () => {
    expect(typeof createAethelredClient).toBe("function");
  });
});
