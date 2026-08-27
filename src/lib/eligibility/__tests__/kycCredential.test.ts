import {
  ZEROID_ELIGIBILITY_POLICY_V1,
  createEligibilityProofRequest,
  formatEligibilityReceipt,
  formatEligibilityRequest,
  type EligibilityProofResponse,
} from "@/lib/eligibility/kycCredential";

describe("ZeroID eligibility client contract", () => {
  it("creates an explicit backend request and cannot weaken policy controls", () => {
    const request = createEligibilityProofRequest(
      {
        subjectDid: "did:aethelred:testnet:holder-1",
        credentialId: "cred-kyc-test-1",
        relyingAppId: "test-relying-app",
        contextNonce: "verifier-issued-context-001",
      },
      {
        requireOnchainAttestation: true,
        requireNonRevocationProof: false,
        dryRun: true,
      },
    );

    expect(request).toEqual({
      subjectDid: "did:aethelred:testnet:holder-1",
      credentialId: "cred-kyc-test-1",
      policyId: ZEROID_ELIGIBILITY_POLICY_V1.policyId,
      relyingAppId: "test-relying-app",
      contextNonce: "verifier-issued-context-001",
      options: {
        requireOnchainAttestation: true,
        requireNonRevocationProof: true,
        dryRun: false,
      },
    });
  });

  it("formats only a supplied backend receipt", () => {
    const receipt = {
      status: "ALLOWED",
      decisionId: "dec_backend_1",
      policyId: ZEROID_ELIGIBILITY_POLICY_V1.policyId,
      policyVersion: ZEROID_ELIGIBILITY_POLICY_V1.version,
      subjectDid: "did:aethelred:testnet:holder-1",
      credentialId: "cred-kyc-test-1",
      relyingAppId: "test-relying-app",
      proof: {
        proofId: "zkp_backend_1",
        verified: true,
        groth16Proof: {
          pi_a: ["1", "2", "1"],
          pi_b: [
            ["3", "4"],
            ["5", "6"],
            ["1", "0"],
          ],
          pi_c: ["7", "8", "1"],
          protocol: "groth16",
          curve: "bn128",
        },
        circuitId: ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.circuitId,
        circuitName: ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.circuitName,
        verificationKeyId:
          ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.verificationKeyId,
        manifestDigest:
          ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.manifestDigest,
        policyBindingDigest:
          ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.policyBindingDigest,
        contextHash: `0x${"1".repeat(64)}`,
        verifiedAt: "2026-07-18T00:00:00.000Z",
        publicSignals: { claimsHash: "123" },
        privateInputsRedacted: ["dateOfBirth"],
        disclosurePolicy: {
          rawFieldsDisclosed: [],
          publicSignals: ["claimsHash"],
          provedPredicates: ["AGE_OVER_THRESHOLD"],
          privateInputsRedacted: ["dateOfBirth"],
          disclosureBudget: {
            rawFieldCount: 0,
            publicSignalCount: 1,
            provedPredicateCount: 1,
            redactedPrivateInputCount: 1,
          },
        },
      },
      evaluation: {
        ageOverThreshold: true,
        residencyAllowed: true,
        nationalityAllowed: true,
        sanctionsClear: true,
        riskAccepted: true,
        credentialActive: true,
        credentialNotExpired: true,
        nonRevocationChecked: true,
        onchainAttested: false,
        teeAttested: true,
        minimumAge: 21,
        computedAge: 30,
        allowedResidencies: ["AE"],
        deniedReasons: [],
      },
      evidence: {
        auditLogId: "audit-backend-1",
        auditHash: `0x${"2".repeat(64)}`,
        teeAttestationId: "tee-backend-1",
        receiptHash: `0x${"3".repeat(64)}`,
        receiptHashAlgorithm: "sha256-canonical-json-v1",
        policyRegistry:
          ZEROID_ELIGIBILITY_POLICY_V1.evidenceAnchors.policyRegistry,
        artifactDigest:
          ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.artifactDigest,
        manifestPath: ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.manifestPath,
        manifestDigest:
          ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.manifestDigest,
        sourceDigest: ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.sourceDigest,
        policyBindingDigest:
          ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.policyBindingDigest,
        artifactStatus:
          ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.artifactStatus,
        evidenceChain: ["credential:cred-kyc-test-1"],
      },
      issuedAt: "2026-07-18T00:00:00.000Z",
    } satisfies EligibilityProofResponse;

    const formatted = JSON.parse(formatEligibilityReceipt(receipt));

    expect(formatted).toMatchObject({
      decisionId: "dec_backend_1",
      proofId: "zkp_backend_1",
      auditHash: `0x${"2".repeat(64)}`,
      receiptHash: `0x${"3".repeat(64)}`,
    });
  });

  it("formats requests without evaluating credentials in the browser", () => {
    const request = createEligibilityProofRequest({
      subjectDid: "did:aethelred:testnet:holder-1",
      credentialId: "cred-kyc-test-1",
      relyingAppId: "test-relying-app",
      contextNonce: "verifier-issued-context-001",
    });

    expect(JSON.parse(formatEligibilityRequest(request))).toEqual(request);
  });
});
