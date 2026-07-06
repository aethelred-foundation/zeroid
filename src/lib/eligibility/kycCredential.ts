/**
 * ZeroID v1 eligibility proof domain model.
 *
 * This module captures the consultant-recommended hero workflow:
 * DID holder + compact KYC VC + age/jurisdiction ZK proof + policy decision
 * + evidence receipt.
 */

export type KycCredentialStatus =
  | "ACTIVE"
  | "SUSPENDED"
  | "REVOKED"
  | "EXPIRED";
export type SanctionsScreeningResult =
  | "CLEAR"
  | "POTENTIAL_MATCH"
  | "CONFIRMED_MATCH";
export type RiskTier = "LOW" | "MEDIUM" | "HIGH";
export type EligibilityDecisionStatus = "ALLOWED" | "DENIED";

export type EligibilityProofErrorCode =
  | "ELIGIBILITY_REQUEST_INVALID"
  | "IDENTITY_NOT_FOUND"
  | "CREDENTIAL_NOT_FOUND"
  | "POLICY_NOT_FOUND"
  | "CREDENTIAL_SUBJECT_MISMATCH"
  | "CREDENTIAL_STATE_INVALID"
  | "PROOF_POLICY_FAILURE"
  | "INTERNAL_ERROR";

export interface ZeroIDKycCredentialV1 {
  schema: "ZeroIDKycCredentialV1";
  version: "1.0";
  credentialId: string;
  subjectDid: string;
  issuerId: string;
  issuedAt: string;
  expiresAt: string;
  attributes: {
    dobYear: number;
    dobMonth?: number;
    dobDay?: number;
    countryOfResidence: string;
    nationality: string;
    sanctionsScreeningResult: SanctionsScreeningResult;
    riskTier: RiskTier;
    status: KycCredentialStatus;
    revocationNonce: string;
  };
  riskProfile: {
    assessmentId: string;
    riskTier: RiskTier;
    score: number;
    assessedAt: string;
    factors: {
      sanctions: "pass" | "review" | "fail";
      jurisdiction: "allow" | "review" | "deny";
      credentialFreshness: "fresh" | "stale";
      revocation: "not_revoked" | "unknown" | "revoked";
    };
  };
  evidence: {
    issuerProofId: string;
    teeAttestationId?: string;
    sourceSystem: string;
    claimsHash: `0x${string}`;
  };
}

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
  status: EligibilityDecisionStatus;
  decisionId: string;
  policyId: string;
  policyVersion: string;
  subjectDid: string;
  credentialId: string;
  relyingAppId: string;
  proof: {
    proofId: string;
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
    regulatoryReportId: string;
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

export class EligibilityProofContractError extends Error {
  public readonly code: EligibilityProofErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: EligibilityProofErrorCode,
    statusCode: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "EligibilityProofContractError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const ZEROID_KYC_CREDENTIAL_SCHEMA_FIELDS = [
  "subjectDid",
  "issuerId",
  "issuedAt",
  "expiresAt",
  "attributes.dobYear",
  "attributes.countryOfResidence",
  "attributes.nationality",
  "attributes.sanctionsScreeningResult",
  "attributes.riskTier",
  "attributes.status",
  "attributes.revocationNonce",
  "riskProfile.assessmentId",
] as const;

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
    verifierContract: "0x784f9d9d8a6c4f7b42e8a6d8e4c62f41a6d60c91",
    auditLogNamespace: "zeroid.audit.eligibility.v1",
  },
};

export const ZEROID_SAMPLE_KYC_CREDENTIAL: ZeroIDKycCredentialV1 = {
  schema: "ZeroIDKycCredentialV1",
  version: "1.0",
  credentialId: "cred_kyc_v1_ae_000184",
  subjectDid: "did:aethelred:mainnet:0x8f4c2a1d6e7b9012cafe",
  issuerId: "issuer.uae-pass.high-assurance",
  issuedAt: "2026-06-01T08:00:00.000Z",
  expiresAt: "2027-06-01T08:00:00.000Z",
  attributes: {
    dobYear: 1993,
    dobMonth: 4,
    dobDay: 18,
    countryOfResidence: "AE",
    nationality: "IN",
    sanctionsScreeningResult: "CLEAR",
    riskTier: "LOW",
    status: "ACTIVE",
    revocationNonce: "rev_ae_000184_6c0191",
  },
  riskProfile: {
    assessmentId: "risk_assessment_ae_2026_000184",
    riskTier: "LOW",
    score: 18,
    assessedAt: "2026-06-01T08:02:12.000Z",
    factors: {
      sanctions: "pass",
      jurisdiction: "allow",
      credentialFreshness: "fresh",
      revocation: "not_revoked",
    },
  },
  evidence: {
    issuerProofId: "issuer_proof_uaepass_000184",
    teeAttestationId: "tee_sgx_uae_issuer_node_7f12a9",
    sourceSystem: "uae-pass-tee-issuer",
    claimsHash:
      "0xe9ec6dd74376c78ab8c6a79e3277e5dcdb1de657b7fbc3316d074ce142e7a0fc",
  },
};

export const RELYING_APP_PROFILES = [
  {
    id: "edge-secure-data-room",
    name: "EDGE Secure Data Room",
    shortName: "EDGE",
    sector: "Defense technology",
    purpose:
      "Gate controlled engineering data rooms without exposing KYC data.",
    requiredAssurance: "ZK + policy receipt + optional on-chain anchor",
  },
  {
    id: "presight-analytics-mesh",
    name: "Presight Analytics Mesh",
    shortName: "Presight",
    sector: "AI and big-data platforms",
    purpose: "Authorize privacy-preserving access to regulated data workflows.",
    requiredAssurance: "ZK + jurisdiction policy + audit evidence",
  },
  {
    id: "tii-research-sandbox",
    name: "TII Research Sandbox",
    shortName: "TII",
    sector: "Advanced research institution",
    purpose:
      "Issue eligibility receipts for restricted research collaboration.",
    requiredAssurance: "ZK + non-revocation + TEE issuer evidence",
  },
] as const;

export type RelyingAppId = (typeof RELYING_APP_PROFILES)[number]["id"];

export function getRelyingAppProfile(relyingAppId: string) {
  return (
    RELYING_APP_PROFILES.find((profile) => profile.id === relyingAppId) ??
    RELYING_APP_PROFILES[0]
  );
}

export function createEligibilityProofRequest(
  relyingAppId: string,
  options: EligibilityProofRequest["options"] = {},
): EligibilityProofRequest {
  return {
    subjectDid: ZEROID_SAMPLE_KYC_CREDENTIAL.subjectDid,
    credentialId: ZEROID_SAMPLE_KYC_CREDENTIAL.credentialId,
    policyId: ZEROID_ELIGIBILITY_POLICY_V1.policyId,
    relyingAppId,
    contextNonce: `nonce_${relyingAppId}_2026_06_23`,
    options: {
      requireOnchainAttestation: false,
      requireNonRevocationProof: true,
      dryRun: true,
      ...options,
    },
  };
}

export function calculateAge(
  credential: ZeroIDKycCredentialV1,
  asOf = new Date(),
): number {
  const { dobYear, dobMonth = 1, dobDay = 1 } = credential.attributes;
  let age = asOf.getUTCFullYear() - dobYear;
  const monthIndex = dobMonth - 1;
  if (
    asOf.getUTCMonth() < monthIndex ||
    (asOf.getUTCMonth() === monthIndex && asOf.getUTCDate() < dobDay)
  ) {
    age -= 1;
  }
  return age;
}

export function isCredentialExpired(
  credential: ZeroIDKycCredentialV1,
  asOf = new Date(),
): boolean {
  return new Date(credential.expiresAt).getTime() <= asOf.getTime();
}

export async function evaluateEligibilityProof(
  request: EligibilityProofRequest,
  credential: ZeroIDKycCredentialV1 = ZEROID_SAMPLE_KYC_CREDENTIAL,
  policy: EligibilityPolicyV1 = ZEROID_ELIGIBILITY_POLICY_V1,
  evaluationOptions: { asOf?: Date } = {},
): Promise<EligibilityProofResponse> {
  assertEligibilityRequest(request);

  if (request.policyId !== policy.policyId) {
    throw new EligibilityProofContractError(
      "Requested eligibility policy is not available.",
      "POLICY_NOT_FOUND",
      404,
      { policyId: request.policyId },
    );
  }

  if (request.credentialId !== credential.credentialId) {
    throw new EligibilityProofContractError(
      "Credential was not found.",
      "CREDENTIAL_NOT_FOUND",
      404,
      { credentialId: request.credentialId },
    );
  }

  if (request.subjectDid !== credential.subjectDid) {
    throw new EligibilityProofContractError(
      "Credential subject does not match the proof request subject.",
      "CREDENTIAL_SUBJECT_MISMATCH",
      403,
      {
        requestSubjectDid: request.subjectDid,
        credentialSubjectDid: credential.subjectDid,
      },
    );
  }

  const asOf = evaluationOptions.asOf ?? new Date();
  const computedAge = calculateAge(credential, asOf);
  const credentialNotExpired = !isCredentialExpired(credential, asOf);
  const requireNonRevocation =
    request.options?.requireNonRevocationProof ??
    policy.requireNonRevocationProof;
  const requireOnchain = request.options?.requireOnchainAttestation === true;
  const dryRun = request.options?.dryRun !== false;

  const evaluation: EligibilityEvaluationFlags = {
    ageOverThreshold: computedAge >= policy.minimumAge,
    residencyAllowed: policy.allowedResidencies.includes(
      credential.attributes.countryOfResidence,
    ),
    nationalityAllowed: policy.allowedNationalities
      ? policy.allowedNationalities.includes(credential.attributes.nationality)
      : true,
    sanctionsClear: policy.requireSanctionsClear
      ? credential.attributes.sanctionsScreeningResult === "CLEAR"
      : true,
    riskAccepted: policy.allowedRiskTiers.includes(
      credential.attributes.riskTier,
    ),
    credentialActive: policy.requireActiveCredential
      ? credential.attributes.status === "ACTIVE"
      : true,
    credentialNotExpired,
    nonRevocationChecked: requireNonRevocation
      ? credential.attributes.status !== "REVOKED" &&
        credential.riskProfile.factors.revocation === "not_revoked" &&
        credential.attributes.revocationNonce.length > 0
      : true,
    onchainAttested: requireOnchain
      ? Boolean(policy.evidenceAnchors.verifierContract) && !dryRun
      : true,
    teeAttested: Boolean(credential.evidence.teeAttestationId),
  };

  const deniedReasons = buildDeniedReasons(evaluation, requireOnchain, dryRun);
  const status: EligibilityDecisionStatus =
    deniedReasons.length === 0 ? "ALLOWED" : "DENIED";

  const verifiedAt = asOf.toISOString();
  const currentTimestamp = String(Math.floor(asOf.getTime() / 1000));
  const policyVersionHash = await sha256Hex(
    stableSerialize({
      policyId: policy.policyId,
      policyVersion: policy.version,
      manifestDigest: policy.circuitManifest.manifestDigest,
    }),
  );
  const contextHash = await sha256Hex(
    stableSerialize({
      subjectDid: request.subjectDid,
      credentialId: request.credentialId,
      policyId: policy.policyId,
      policyVersion: policy.version,
      relyingAppId: request.relyingAppId,
      contextNonce: request.contextNonce,
    }),
  );
  const publicSignals = {
    claimsHash: credential.evidence.claimsHash,
    ageThresholdYears: String(policy.minimumAge),
    residencyCountryCode: credential.attributes.countryOfResidence,
    currentTimestamp,
    policyVersionHash,
    contextCommitment: contextHash,
  };
  const disclosurePolicy = buildDisclosurePolicy(
    evaluation,
    policy.circuitManifest.privateInputsRedacted,
    Object.keys(publicSignals),
  );

  const receiptSeed = stableSerialize({
    status,
    request,
    policyVersion: policy.version,
    contextHash,
    verifiedAt,
    evaluation,
    publicSignals,
    disclosurePolicy,
  });
  const receiptHash = await sha256Hex(receiptSeed);
  const auditHash = await sha256Hex(
    stableSerialize({
      namespace: policy.evidenceAnchors.auditLogNamespace,
      receiptHash,
      claimsHash: credential.evidence.claimsHash,
    }),
  );
  const decisionDigest = await sha256Hex(`decision:${receiptHash}`);
  const proofDigest = await sha256Hex(`proof:${contextHash}:${receiptHash}`);
  const regulatoryDigest = await sha256Hex(`regulatory:${receiptHash}`);
  const txHash =
    requireOnchain && !dryRun
      ? await sha256Hex(
          `onchain:${receiptHash}:${policy.evidenceAnchors.verifierContract}`,
        )
      : undefined;

  return {
    status,
    decisionId: `dec_${decisionDigest.slice(2, 18)}`,
    policyId: policy.policyId,
    policyVersion: policy.version,
    subjectDid: request.subjectDid,
    credentialId: request.credentialId,
    relyingAppId: request.relyingAppId,
    proof: {
      proofId: `zkp_${proofDigest.slice(2, 18)}`,
      circuitId: policy.circuitManifest.circuitId,
      circuitName: policy.circuitManifest.circuitName,
      verificationKeyId: policy.circuitManifest.verificationKeyId,
      manifestDigest: policy.circuitManifest.manifestDigest,
      policyBindingDigest: policy.circuitManifest.policyBindingDigest,
      contextHash,
      verifiedAt,
      onchainTxHash: txHash,
      publicSignals,
      privateInputsRedacted: policy.circuitManifest.privateInputsRedacted,
      disclosurePolicy,
    },
    evaluation: {
      ...evaluation,
      minimumAge: policy.minimumAge,
      computedAge,
      allowedResidencies: policy.allowedResidencies,
      deniedReasons,
    },
    evidence: {
      auditLogId: `aud_${auditHash.slice(2, 18)}`,
      auditHash,
      regulatoryReportId: `reg_${regulatoryDigest.slice(2, 14)}`,
      teeAttestationId: credential.evidence.teeAttestationId,
      receiptHash,
      receiptHashAlgorithm: "sha256-canonical-json-v1",
      policyRegistry: policy.evidenceAnchors.policyRegistry,
      artifactDigest: policy.circuitManifest.artifactDigest,
      manifestPath: policy.circuitManifest.manifestPath,
      manifestDigest: policy.circuitManifest.manifestDigest,
      sourceDigest: policy.circuitManifest.sourceDigest,
      policyBindingDigest: policy.circuitManifest.policyBindingDigest,
      artifactStatus: policy.circuitManifest.artifactStatus,
      evidenceChain: [
        credential.evidence.issuerProofId,
        credential.evidence.teeAttestationId ?? "tee_attestation_not_required",
        policy.circuitManifest.manifestDigest,
        policy.circuitManifest.verificationKeyId,
        policy.evidenceAnchors.auditLogNamespace,
      ],
    },
    issuedAt: verifiedAt,
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

function assertEligibilityRequest(request: EligibilityProofRequest): void {
  const missing = [
    "subjectDid",
    "credentialId",
    "policyId",
    "relyingAppId",
    "contextNonce",
  ].filter((field) => {
    const value = request[field as keyof EligibilityProofRequest];
    return typeof value !== "string" || value.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new EligibilityProofContractError(
      "Eligibility proof request is missing required fields.",
      "ELIGIBILITY_REQUEST_INVALID",
      400,
      { missing },
    );
  }
}

function buildDeniedReasons(
  evaluation: EligibilityEvaluationFlags,
  requireOnchain: boolean,
  dryRun: boolean,
): string[] {
  const reasons: string[] = [];
  if (!evaluation.ageOverThreshold) reasons.push("AGE_THRESHOLD_NOT_MET");
  if (!evaluation.residencyAllowed) reasons.push("RESIDENCY_NOT_ALLOWED");
  if (!evaluation.nationalityAllowed) reasons.push("NATIONALITY_NOT_ALLOWED");
  if (!evaluation.sanctionsClear) reasons.push("SANCTIONS_NOT_CLEAR");
  if (!evaluation.riskAccepted) reasons.push("RISK_TIER_NOT_ACCEPTED");
  if (!evaluation.credentialActive) reasons.push("CREDENTIAL_NOT_ACTIVE");
  if (!evaluation.credentialNotExpired) reasons.push("CREDENTIAL_EXPIRED");
  if (!evaluation.nonRevocationChecked) {
    reasons.push("NON_REVOCATION_PROOF_MISSING");
  }
  if (!evaluation.teeAttested) reasons.push("TEE_ATTESTATION_MISSING");
  if (requireOnchain && dryRun) {
    reasons.push("ONCHAIN_ATTESTATION_REQUIRES_LIVE_MODE");
  } else if (!evaluation.onchainAttested) {
    reasons.push("ONCHAIN_ATTESTATION_MISSING");
  }
  return reasons;
}

function buildDisclosurePolicy(
  evaluation: EligibilityEvaluationFlags,
  privateInputsRedacted: string[],
  publicSignals: string[],
): EligibilityDisclosurePolicy {
  const predicateLabels: Array<[keyof EligibilityEvaluationFlags, string]> = [
    ["ageOverThreshold", "AGE_OVER_THRESHOLD"],
    ["residencyAllowed", "RESIDENCY_ALLOWED"],
    ["nationalityAllowed", "NATIONALITY_ALLOWED"],
    ["sanctionsClear", "SANCTIONS_CLEAR"],
    ["riskAccepted", "RISK_ACCEPTED"],
    ["credentialActive", "CREDENTIAL_ACTIVE"],
    ["credentialNotExpired", "CREDENTIAL_NOT_EXPIRED"],
    ["nonRevocationChecked", "NON_REVOCATION_CHECKED"],
    ["onchainAttested", "ONCHAIN_ATTESTED"],
    ["teeAttested", "TEE_ATTESTED"],
  ];
  const provedPredicates = predicateLabels
    .filter(([key]) => evaluation[key])
    .map(([, label]) => label);

  return {
    rawFieldsDisclosed: [],
    publicSignals,
    provedPredicates,
    privateInputsRedacted,
    disclosureBudget: {
      rawFieldCount: 0,
      publicSignalCount: publicSignals.length,
      provedPredicateCount: provedPredicates.length,
      redactedPrivateInputCount: privateInputsRedacted.length,
    },
  };
}

export function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(",")}}`;
}

async function sha256Hex(value: string): Promise<`0x${string}`> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const bytes = new TextEncoder().encode(value);
    const digest = await subtle.digest("SHA-256", bytes);
    return `0x${Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;
  }

  return `0x${fallbackDigest(value)}`;
}

function fallbackDigest(value: string): string {
  let hashA = 0x811c9dc5;
  let hashB = 0x01000193;
  for (let i = 0; i < value.length; i += 1) {
    hashA ^= value.charCodeAt(i);
    hashA = Math.imul(hashA, 0x01000193);
    hashB ^= value.charCodeAt(value.length - i - 1);
    hashB = Math.imul(hashB, 0x811c9dc5);
  }

  const chunk = `${(hashA >>> 0).toString(16).padStart(8, "0")}${(hashB >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
  return chunk.repeat(4).slice(0, 64);
}
