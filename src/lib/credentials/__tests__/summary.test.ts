import {
  CredentialResponseContractError,
  credentialTypeLabel,
  normalizeCredentialSummaries,
  normalizeCredentialSummary,
} from "../summary";

const backendCredential = {
  id: "d74ed26c-47ac-4b62-94a8-38704c53b876",
  credentialType: "KYC_LEVEL_2",
  issuerId: "issuer-record-17",
  subjectId: "subject-record-8",
  claimsHash:
    "3f3bd8d3d60d1412f98f8f366f0bbbea21c10ac40db80a9e28fa8911223e7f4b",
  proof: { type: "DataIntegrityProof" },
  status: "ACTIVE",
  issuedAt: "2026-07-18T08:00:00.000Z",
  expiresAt: "2027-07-18T08:00:00.000Z",
};

describe("credential summary contract", () => {
  it("normalizes the backend record without inventing DID or on-chain fields", () => {
    const summary = normalizeCredentialSummary(backendCredential);

    expect(summary).toEqual({
      id: backendCredential.id,
      credentialType: "KYC_LEVEL_2",
      typeLabel: "KYC Level 2",
      category: "kyc",
      issuerId: "issuer-record-17",
      subjectId: "subject-record-8",
      claimsHash: backendCredential.claimsHash,
      proofAvailable: true,
      status: "active",
      issuedAt: "2026-07-18T08:00:00.000Z",
      expiresAt: "2027-07-18T08:00:00.000Z",
    });
    expect(summary).not.toHaveProperty("issuerDid");
    expect(summary).not.toHaveProperty("schemaType");
    expect(summary).not.toHaveProperty("hash");
  });

  it.each([
    ["SUSPENDED", "suspended"],
    ["REVOKED", "revoked"],
    ["EXPIRED", "expired"],
    ["FUTURE_STATE", "unknown"],
  ])("maps backend status %s to %s", (status, expected) => {
    expect(
      normalizeCredentialSummary({ ...backendCredential, status }).status,
    ).toBe(expected);
  });

  it("preserves a missing expiry and missing proof honestly", () => {
    expect(
      normalizeCredentialSummary({
        ...backendCredential,
        proof: null,
        expiresAt: null,
      }),
    ).toMatchObject({ expiresAt: null, proofAvailable: false });
  });

  it("requires the proof field while allowing an explicit null proof", () => {
    const { proof: _proof, ...withoutProof } = backendCredential;
    expect(() => normalizeCredentialSummary(withoutProof)).toThrow(
      'Credential response field "proof" is required',
    );
    expect(
      normalizeCredentialSummary({ ...backendCredential, proof: null })
        .proofAvailable,
    ).toBe(false);
  });

  it("fails closed when a required backend field is absent", () => {
    expect(() =>
      normalizeCredentialSummaries([
        { ...backendCredential, claimsHash: undefined },
      ]),
    ).toThrow(
      new CredentialResponseContractError(
        'Credential list item 0: Credential response field "claimsHash" must be a non-empty string',
      ),
    );
  });

  it.each([
    "0x3f3bd8d3d60d1412f98f8f366f0bbbea21c10ac40db80a9e28fa8911223e7f4b",
    "3F3BD8D3D60D1412F98F8F366F0BBBEA21C10AC40DB80A9E28FA8911223E7F4B",
    "not-a-digest",
  ])("rejects non-canonical claims hash %s", (claimsHash) => {
    expect(() =>
      normalizeCredentialSummary({ ...backendCredential, claimsHash }),
    ).toThrow(
      'Credential response field "claimsHash" must be a canonical lowercase SHA-256 hex digest',
    );
  });

  it("rejects a non-array list response", () => {
    expect(() => normalizeCredentialSummaries({ data: [] })).toThrow(
      "Credential list response must be an array",
    );
  });

  it("formats unknown credential types without claiming a schema", () => {
    expect(credentialTypeLabel("SOVEREIGN_ACCOUNT_TIER")).toBe(
      "Sovereign Account Tier",
    );
    expect(
      normalizeCredentialSummary({
        ...backendCredential,
        credentialType: "SOVEREIGN_ACCOUNT_TIER",
      }).category,
    ).toBe("custom");
  });
});
