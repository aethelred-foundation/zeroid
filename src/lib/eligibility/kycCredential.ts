/**
 * ZeroID v1 eligibility proof domain model.
 *
 * Shared request, policy, and evidence contracts for authenticated eligibility
 * evaluation. Browser code must supply real identity and credential context;
 * no sample holder or default credential exists in this module.
 */

type RiskTier = "LOW" | "MEDIUM" | "HIGH";

export interface EligibilityPolicyV1 {
  policyId: string;
  version: string;
  label: string;
  minimumAge: number;
  allowedResidencies: string[];
  allowedNationalities?: string[];
  allowedRiskTiers: RiskTier[];
  requireSanctionsClear: boolean;
  requireActiveCredential: boolean;
  requireNonRevocationProof: boolean;
  circuitManifest: {
    circuitId: string;
    circuitName: string;
    verificationKeyId: string;
    manifestPath: string;
    sourcePath: string;
    manifestDigest: `0x${string}`;
    sourceDigest: `0x${string}`;
    policyBindingDigest: `0x${string}`;
    artifactDigest: `0x${string}`;
    artifactStatus:
      | "SOURCE_VALIDATED_ARTIFACTS_PENDING"
      | "PINNED_PRODUCTION_ARTIFACTS";
    publicSignals: string[];
    privateInputsRedacted: string[];
  };
  evidenceAnchors: {
    policyRegistry: string;
    verifierContract?: `0x${string}`;
    auditLogNamespace: string;
  };
}

export interface EligibilityProofRequest {
  subjectDid: string;
  credentialId: string;
  policyId: string;
  relyingAppId: string;
  contextNonce: string;
  options?: {
    requireOnchainAttestation?: boolean;
    requireNonRevocationProof?: boolean;
    dryRun?: boolean;
  };
}

export interface EligibilityEvaluationFlags {
  ageOverThreshold: boolean;
  residencyAllowed: boolean;
  nationalityAllowed: boolean;
  sanctionsClear: boolean;
  riskAccepted: boolean;
  credentialActive: boolean;
  credentialNotExpired: boolean;
  nonRevocationChecked: boolean;
  onchainAttested: boolean;
  teeAttested: boolean;
}

export interface EligibilityDisclosurePolicy {
  rawFieldsDisclosed: string[];
  publicSignals: string[];
  provedPredicates: string[];
  privateInputsRedacted: string[];
  disclosureBudget: {
    rawFieldCount: number;
    publicSignalCount: number;
    provedPredicateCount: number;
    redactedPrivateInputCount: number;
  };
}

export interface EligibilityProofResponse {
  status: "ALLOWED" | "DENIED";
  decisionId: string;
  policyId: string;
  policyVersion: string;
  subjectDid: string;
  credentialId: string;
  relyingAppId: string;
  proof: {
    proofId: string;
    verified: true;
    groth16Proof: {
      pi_a: string[];
      pi_b: string[][];
      pi_c: string[];
      protocol: "groth16";
      curve: "bn128";
    };
    circuitId: string;
    circuitName: string;
    verificationKeyId: string;
    manifestDigest: `0x${string}`;
    policyBindingDigest: `0x${string}`;
    contextHash: `0x${string}`;
    verifiedAt: string;
    onchainTxHash?: `0x${string}`;
    publicSignals: Record<string, string>;
    privateInputsRedacted: string[];
    disclosurePolicy: EligibilityDisclosurePolicy;
  };
  evaluation: EligibilityEvaluationFlags & {
    minimumAge: number;
    computedAge: number;
    allowedResidencies: string[];
    deniedReasons: string[];
  };
  evidence: {
    auditLogId: string;
    auditHash: `0x${string}`;
    regulatoryReportId?: string;
    teeAttestationId?: string;
    receiptHash: `0x${string}`;
    receiptHashAlgorithm: "sha256-canonical-json-v1";
    policyRegistry: string;
    artifactDigest: `0x${string}`;
    manifestPath: string;
    manifestDigest: `0x${string}`;
    sourceDigest: `0x${string}`;
    policyBindingDigest: `0x${string}`;
    artifactStatus:
      | "SOURCE_VALIDATED_ARTIFACTS_PENDING"
      | "PINNED_PRODUCTION_ARTIFACTS";
    evidenceChain: string[];
  };
  issuedAt: string;
}

export const ZEROID_ELIGIBILITY_POLICY_V1: EligibilityPolicyV1 = {
  policyId:
    "zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1",
  version: "2026.06.1",
  label: "Age + jurisdiction eligibility for regulated digital services",
  minimumAge: 21,
  allowedResidencies: ["AE"],
  allowedNationalities: ["AE", "IN", "US", "GB", "SG"],
  allowedRiskTiers: ["LOW", "MEDIUM"],
  requireSanctionsClear: true,
  requireActiveCredential: true,
  requireNonRevocationProof: true,
  circuitManifest: {
    circuitId: "zkc_eligibility_policy_context_v1",
    circuitName: "eligibility_policy_context_v1",
    verificationKeyId: "vk_eligibility_policy_context_v1_2026_06_27",
    manifestPath: "circuits/manifest/eligibility_v1.json",
    sourcePath: "circuits/eligibility/eligibility_context_proof.circom",
    manifestDigest:
      "0x1f48ddf10a370c1ab6af80f17e359f0c00700b5151a7ee1db835dfdb3cde25e5",
    sourceDigest:
      "0xac4d4468fd32692373b5a5942a94588120bfbbda82b151da8aa92a12fd6393e3",
    policyBindingDigest:
      "0xc339f81323c5288c23a30a0fcbc3140bdb60f79193101cbc8ee0fc42eda45e0c",
    artifactDigest:
      "0xac4d4468fd32692373b5a5942a94588120bfbbda82b151da8aa92a12fd6393e3",
    artifactStatus: "SOURCE_VALIDATED_ARTIFACTS_PENDING",
    publicSignals: [
      "claimsHash",
      "ageThresholdYears",
      "residencyCountryCode",
      "currentTimestamp",
      "policyVersionHash",
      "contextCommitment",
    ],
    privateInputsRedacted: [
      "dateOfBirth",
      "dobYear",
      "dobMonth",
      "dobDay",
      "nationality",
      "revocationNonce",
      "sanctionsScreeningResult",
      "riskTier",
      "issuerSignature",
      "policyVersionHashWitness",
      "contextCommitmentWitness",
    ],
  },
  evidenceAnchors: {
    policyRegistry: "zeroid://policy-registry/core/regulated-digital-services",
    auditLogNamespace: "zeroid.audit.eligibility.v1",
  },
};

export function createEligibilityProofRequest(
  input: Pick<
    EligibilityProofRequest,
    "subjectDid" | "credentialId" | "relyingAppId" | "contextNonce"
  >,
  options: EligibilityProofRequest["options"] = {},
): EligibilityProofRequest {
  return {
    subjectDid: input.subjectDid,
    credentialId: input.credentialId,
    policyId: ZEROID_ELIGIBILITY_POLICY_V1.policyId,
    relyingAppId: input.relyingAppId,
    contextNonce: input.contextNonce,
    options: {
      requireOnchainAttestation: options.requireOnchainAttestation === true,
      requireNonRevocationProof: true,
      dryRun: false,
    },
  };
}

export function formatEligibilityReceipt(
  receipt: EligibilityProofResponse,
): string {
  return JSON.stringify(
    {
      status: receipt.status,
      decisionId: receipt.decisionId,
      policy: `${receipt.policyId}@${receipt.policyVersion}`,
      proofId: receipt.proof.proofId,
      circuitId: receipt.proof.circuitId,
      verificationKeyId: receipt.proof.verificationKeyId,
      manifestDigest: receipt.evidence.manifestDigest,
      policyBindingDigest: receipt.evidence.policyBindingDigest,
      artifactStatus: receipt.evidence.artifactStatus,
      contextHash: receipt.proof.contextHash,
      disclosureBudget: receipt.proof.disclosurePolicy.disclosureBudget,
      auditHash: receipt.evidence.auditHash,
      receiptHash: receipt.evidence.receiptHash,
      receiptHashAlgorithm: receipt.evidence.receiptHashAlgorithm,
      issuedAt: receipt.issuedAt,
    },
    null,
    2,
  );
}

export function formatEligibilityRequest(
  request: EligibilityProofRequest,
): string {
  return JSON.stringify(request, null, 2);
}
