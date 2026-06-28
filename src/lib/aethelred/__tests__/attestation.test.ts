import {
  mapTeePlatform,
  verifyTeeAttestationCanonical,
} from "@/lib/aethelred/attestation";
import { getVerificationModule } from "@/lib/aethelred/client";
import { TEEPlatform } from "@aethelred/sdk";

jest.mock("@/lib/aethelred/client");
const mockedGetVerificationModule =
  getVerificationModule as jest.MockedFunction<typeof getVerificationModule>;

describe("mapTeePlatform", () => {
  it("maps ZeroID numeric platforms to the canonical enum", () => {
    expect(mapTeePlatform(1)).toBe(TEEPlatform.INTEL_SGX);
    expect(mapTeePlatform(2)).toBe(TEEPlatform.AMD_SEV);
    expect(mapTeePlatform(3)).toBe(TEEPlatform.ARM_TRUSTZONE);
    expect(mapTeePlatform(0)).toBe(TEEPlatform.UNSPECIFIED);
    expect(mapTeePlatform(99)).toBe(TEEPlatform.UNSPECIFIED);
  });
});

describe("verifyTeeAttestationCanonical", () => {
  afterEach(() => jest.clearAllMocks());

  const attestation = {
    platform: TEEPlatform.INTEL_SGX,
    quote: "base64quote",
    enclaveHash: "0xabc",
    timestamp: new Date(0),
    pcrValues: {},
  };

  it("delegates to verifyTEEAttestation and returns the result", async () => {
    const verifyTEEAttestation = jest.fn().mockResolvedValue({
      valid: true,
      platform: TEEPlatform.INTEL_SGX,
      enclaveHash: "0xabc",
    });
    mockedGetVerificationModule.mockReturnValue({ verifyTEEAttestation } as never);

    const result = await verifyTeeAttestationCanonical(attestation, "0xabc");

    expect(verifyTEEAttestation).toHaveBeenCalledWith(attestation, "0xabc");
    expect(result.valid).toBe(true);
    expect(result.platform).toBe(TEEPlatform.INTEL_SGX);
    expect(result.enclaveHash).toBe("0xabc");
  });

  it("propagates an invalid result and its error", async () => {
    const verifyTEEAttestation = jest.fn().mockResolvedValue({
      valid: false,
      platform: TEEPlatform.UNSPECIFIED,
      error: "bad quote",
    });
    mockedGetVerificationModule.mockReturnValue({ verifyTEEAttestation } as never);

    const result = await verifyTeeAttestationCanonical(attestation);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("bad quote");
  });
});
