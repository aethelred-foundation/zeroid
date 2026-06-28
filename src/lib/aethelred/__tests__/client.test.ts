import {
  getAethelredClient,
  getVerificationModule,
  getSealsModule,
  resetAethelredClient,
} from "@/lib/aethelred/client";
import { VerificationModule, SealsModule } from "@aethelred/sdk";

describe("aethelred boundary client", () => {
  afterEach(() => resetAethelredClient());

  it("returns a singleton client", () => {
    expect(getAethelredClient()).toBe(getAethelredClient());
  });

  it("exposes a VerificationModule", () => {
    expect(getVerificationModule()).toBeInstanceOf(VerificationModule);
  });

  it("exposes a SealsModule", () => {
    expect(getSealsModule()).toBeInstanceOf(SealsModule);
  });

  it("rebuilds the client after reset", () => {
    const first = getAethelredClient();
    resetAethelredClient();
    expect(getAethelredClient()).not.toBe(first);
  });
});
