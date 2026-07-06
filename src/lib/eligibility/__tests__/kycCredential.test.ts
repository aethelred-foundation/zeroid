import {
  EligibilityProofContractError,
  ZEROID_ELIGIBILITY_POLICY_V1,
  ZEROID_SAMPLE_KYC_CREDENTIAL,
  calculateAge,
  createEligibilityProofRequest,
  evaluateEligibilityProof,
} from "@/lib/eligibility/kycCredential";

const AS_OF = new Date("2026-06-23T10:00:00.000Z");

describe("ZeroID eligibility proof model", () => {
  it("calculates age from the compact KYC credential date fields", () => {
    expect(calculateAge(ZEROID_SAMPLE_KYC_CREDENTIAL, AS_OF)).toBe(33);
  });

  it("allows the sample holder for the regulated services policy", async () => {
    const request = createEligibilityProofRequest("edge-secure-data-room");

    const receipt = await evaluateEligibilityProof(
      request,
      ZEROID_SAMPLE_KYC_CREDENTIAL,
      ZEROID_ELIGIBILITY_POLICY_V1,
      { asOf: AS_OF },
    );

    expect(receipt.status).toBe("ALLOWED");
    expect(receipt.policyVersion).toBe("2026.06.1");
    expect(receipt.evaluation).toMatchObject({
      ageOverThreshold: true,
      residencyAllowed: true,
      sanctionsClear: true,
      riskAccepted: true,
      nonRevocationChecked: true,
      teeAttested: true,
    });
    expect(receipt.proof.privateInputsRedacted).toContain("dobYear");
    expect(receipt.proof.disclosurePolicy.rawFieldsDisclosed).toEqual([]);
    expect(receipt.proof.disclosurePolicy.disclosureBudget).toMatchObject({
      rawFieldCount: 0,
      publicSignalCount: 6,
      redactedPrivateInputCount:
        ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.privateInputsRedacted
          .length,
    });
    expect(receipt.proof.disclosurePolicy.provedPredicates).toEqual(
      expect.arrayContaining([
        "AGE_OVER_THRESHOLD",
        "RESIDENCY_ALLOWED",
        "SANCTIONS_CLEAR",
        "NON_REVOCATION_CHECKED",
        "TEE_ATTESTED",
      ]),
    );
    expect(receipt.evidence.receiptHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(receipt.evidence.receiptHashAlgorithm).toBe(
      "sha256-canonical-json-v1",
    );
    expect(receipt.evidence.manifestDigest).toBe(
      ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.manifestDigest,
    );
    expect(receipt.evidence.policyBindingDigest).toBe(
      ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.policyBindingDigest,
    );
    expect(receipt.proof.publicSignals).toMatchObject({
      claimsHash: ZEROID_SAMPLE_KYC_CREDENTIAL.evidence.claimsHash,
      residencyCountryCode: "AE",
    });
    expect(receipt.proof.publicSignals.policyVersionHash).toMatch(
      /^0x[0-9a-f]{64}$/,
    );
  });

  it("returns deterministic receipt identifiers for the same proof context", async () => {
    const request = createEligibilityProofRequest("presight-analytics-mesh");

    const first = await evaluateEligibilityProof(
      request,
      ZEROID_SAMPLE_KYC_CREDENTIAL,
      ZEROID_ELIGIBILITY_POLICY_V1,
      { asOf: AS_OF },
    );
    const second = await evaluateEligibilityProof(
      request,
      ZEROID_SAMPLE_KYC_CREDENTIAL,
      ZEROID_ELIGIBILITY_POLICY_V1,
      { asOf: AS_OF },
    );

    expect(second.decisionId).toBe(first.decisionId);
    expect(second.proof.proofId).toBe(first.proof.proofId);
    expect(second.evidence.auditHash).toBe(first.evidence.auditHash);
  });

  it("binds the disclosure policy to the receipt hash", async () => {
    const request = createEligibilityProofRequest("edge-secure-data-room");
    const baseline = await evaluateEligibilityProof(
      request,
      ZEROID_SAMPLE_KYC_CREDENTIAL,
      ZEROID_ELIGIBILITY_POLICY_V1,
      { asOf: AS_OF },
    );
    const stricterDisclosurePolicy = {
      ...ZEROID_ELIGIBILITY_POLICY_V1,
      circuitManifest: {
        ...ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest,
        privateInputsRedacted: [
          ...ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.privateInputsRedacted,
          "manualReviewNotes",
        ],
      },
    };

    const changed = await evaluateEligibilityProof(
      request,
      ZEROID_SAMPLE_KYC_CREDENTIAL,
      stricterDisclosurePolicy,
      { asOf: AS_OF },
    );

    expect(changed.status).toBe(baseline.status);
    expect(changed.proof.disclosurePolicy.privateInputsRedacted).toContain(
      "manualReviewNotes",
    );
    expect(changed.evidence.receiptHash).not.toBe(
      baseline.evidence.receiptHash,
    );
  });

  it("denies credentials that fail sanctions screening", async () => {
    const request = createEligibilityProofRequest("tii-research-sandbox");
    const credential = {
      ...ZEROID_SAMPLE_KYC_CREDENTIAL,
      attributes: {
        ...ZEROID_SAMPLE_KYC_CREDENTIAL.attributes,
        sanctionsScreeningResult: "POTENTIAL_MATCH" as const,
      },
    };

    const receipt = await evaluateEligibilityProof(
      request,
      credential,
      ZEROID_ELIGIBILITY_POLICY_V1,
      { asOf: AS_OF },
    );

    expect(receipt.status).toBe("DENIED");
    expect(receipt.evaluation.deniedReasons).toContain("SANCTIONS_NOT_CLEAR");
  });

  it("rejects a proof request for the wrong subject DID", async () => {
    const request = {
      ...createEligibilityProofRequest("edge-secure-data-room"),
      subjectDid: "did:aethelred:mainnet:0xwrong",
    };

    await expect(
      evaluateEligibilityProof(
        request,
        ZEROID_SAMPLE_KYC_CREDENTIAL,
        ZEROID_ELIGIBILITY_POLICY_V1,
        { asOf: AS_OF },
      ),
    ).rejects.toMatchObject({
      name: "EligibilityProofContractError",
      code: "CREDENTIAL_SUBJECT_MISMATCH",
      statusCode: 403,
    } satisfies Partial<EligibilityProofContractError>);
  });

  it("marks dry-run on-chain requirements as not production-attested", async () => {
    const request = createEligibilityProofRequest("edge-secure-data-room", {
      requireOnchainAttestation: true,
      dryRun: true,
    });

    const receipt = await evaluateEligibilityProof(
      request,
      ZEROID_SAMPLE_KYC_CREDENTIAL,
      ZEROID_ELIGIBILITY_POLICY_V1,
      { asOf: AS_OF },
    );

    expect(receipt.status).toBe("DENIED");
    expect(receipt.evaluation.deniedReasons).toContain(
      "ONCHAIN_ATTESTATION_REQUIRES_LIVE_MODE",
    );
    expect(receipt.proof.onchainTxHash).toBeUndefined();
  });

  it("keeps raw KYC fields out of the disclosure policy for denied proofs", async () => {
    const request = createEligibilityProofRequest("presight-analytics-mesh");
    const credential = {
      ...ZEROID_SAMPLE_KYC_CREDENTIAL,
      attributes: {
        ...ZEROID_SAMPLE_KYC_CREDENTIAL.attributes,
        status: "SUSPENDED" as const,
      },
    };

    const receipt = await evaluateEligibilityProof(
      request,
      credential,
      ZEROID_ELIGIBILITY_POLICY_V1,
      { asOf: AS_OF },
    );

    expect(receipt.status).toBe("DENIED");
    expect(receipt.evaluation.deniedReasons).toContain("CREDENTIAL_NOT_ACTIVE");
    expect(receipt.proof.disclosurePolicy.rawFieldsDisclosed).toHaveLength(0);
    expect(receipt.proof.disclosurePolicy.privateInputsRedacted).toEqual(
      ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.privateInputsRedacted,
    );
    expect(receipt.proof.disclosurePolicy.provedPredicates).not.toContain(
      "CREDENTIAL_ACTIVE",
    );
  });
});
