/**
 * ZeroID Application Constants
 *
 * Contract addresses, credential schema definitions, attribute types,
 * circuit metadata, and network configuration constants.
 */

import type { Address, Bytes32, CircuitMeta } from '@/types';

// ============================================================================
// Contract Addresses (populated per-environment via env vars)
// ============================================================================

export const CONTRACT_ADDRESSES = {
  identityRegistry: (process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS || '') as Address,
  credentialRegistry: (process.env.NEXT_PUBLIC_CREDENTIAL_REGISTRY_ADDRESS || '') as Address,
  zkVerifier: (process.env.NEXT_PUBLIC_ZK_VERIFIER_ADDRESS || '') as Address,
  teeAttestation: (process.env.NEXT_PUBLIC_TEE_ATTESTATION_ADDRESS || '') as Address,
  selectiveDisclosure: (process.env.NEXT_PUBLIC_SELECTIVE_DISCLOSURE_ADDRESS || '') as Address,
  governanceModule: (process.env.NEXT_PUBLIC_GOVERNANCE_MODULE_ADDRESS || '') as Address,
  aethelToken: (process.env.NEXT_PUBLIC_AETHEL_TOKEN_ADDRESS || '') as Address,
  // Enterprise contracts
  bbsPlusCredential: (process.env.NEXT_PUBLIC_BBS_PLUS_ADDRESS || '') as Address,
  thresholdCredential: (process.env.NEXT_PUBLIC_THRESHOLD_CREDENTIAL_ADDRESS || '') as Address,
  crossChainBridge: (process.env.NEXT_PUBLIC_BRIDGE_CONTRACT_ADDRESS || '') as Address,
  accumulatorRevocation: (process.env.NEXT_PUBLIC_ACCUMULATOR_REVOCATION_ADDRESS || '') as Address,
  aiAgentRegistry: (process.env.NEXT_PUBLIC_AI_AGENT_REGISTRY_ADDRESS || '') as Address,
  regulatoryCompliance: (process.env.NEXT_PUBLIC_REGULATORY_COMPLIANCE_ADDRESS || '') as Address,
} as const;

// Convenience aliases used by hooks
export const IDENTITY_REGISTRY_ADDRESS = CONTRACT_ADDRESSES.identityRegistry;
export const CREDENTIAL_REGISTRY_ADDRESS = CONTRACT_ADDRESSES.credentialRegistry;

// Minimal ABIs for on-chain reads/writes
export const IDENTITY_REGISTRY_ABI = [
  { type: 'function', name: 'identityOf', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'getDelegates', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: '', type: 'tuple[]', components: [{ name: 'delegate', type: 'address' }, { name: 'expiry', type: 'uint256' }] }], stateMutability: 'view' },
  { type: 'function', name: 'registerIdentity', inputs: [{ name: 'didHash', type: 'bytes32' }, { name: 'recovery', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'addDelegate', inputs: [{ name: 'delegate', type: 'address' }, { name: 'expiry', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'revokeDelegate', inputs: [{ name: 'delegate', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
] as const;

export const CREDENTIAL_REGISTRY_ABI = [
  { type: 'function', name: 'getCredential', inputs: [{ name: 'credentialId', type: 'bytes32' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'issuer', type: 'address' }, { name: 'holder', type: 'address' }, { name: 'schemaHash', type: 'bytes32' }, { name: 'issuedAt', type: 'uint256' }, { name: 'expiresAt', type: 'uint256' }, { name: 'revoked', type: 'bool' }] }], stateMutability: 'view' },
  { type: 'function', name: 'revokeCredential', inputs: [{ name: 'credentialId', type: 'bytes32' }], outputs: [], stateMutability: 'nonpayable' },
] as const;

export const GOVERNANCE_ADDRESS = CONTRACT_ADDRESSES.governanceModule;
export const GOVERNANCE_TOKEN_ADDRESS = CONTRACT_ADDRESSES.aethelToken;
export const ZK_VERIFIER_ADDRESS = CONTRACT_ADDRESSES.zkVerifier;
export const ZK_CIRCUIT_BASE_URL = process.env.NEXT_PUBLIC_ZK_CIRCUIT_BASE_URL || '/circuits';

export const GOVERNANCE_ABI = [
  { type: 'function', name: 'proposalVotes', inputs: [{ name: 'proposalId', type: 'uint256' }], outputs: [{ name: 'againstVotes', type: 'uint256' }, { name: 'forVotes', type: 'uint256' }, { name: 'abstainVotes', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'propose', inputs: [{ name: 'targets', type: 'address[]' }, { name: 'values', type: 'uint256[]' }, { name: 'calldatas', type: 'bytes[]' }, { name: 'description', type: 'string' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'castVote', inputs: [{ name: 'proposalId', type: 'uint256' }, { name: 'support', type: 'uint8' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'castVoteWithReason', inputs: [{ name: 'proposalId', type: 'uint256' }, { name: 'support', type: 'uint8' }, { name: 'reason', type: 'string' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'execute', inputs: [{ name: 'targets', type: 'address[]' }, { name: 'values', type: 'uint256[]' }, { name: 'calldatas', type: 'bytes[]' }, { name: 'descriptionHash', type: 'bytes32' }], outputs: [], stateMutability: 'payable' },
] as const;

export const GOVERNANCE_TOKEN_ABI = [
  { type: 'function', name: 'getVotes', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'delegates', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'delegate', inputs: [{ name: 'delegatee', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
] as const;

export const ZK_VERIFIER_ABI = [
  { type: 'function', name: 'verifyProof', inputs: [{ name: 'a', type: 'uint256[2]' }, { name: 'b', type: 'uint256[2][2]' }, { name: 'c', type: 'uint256[2]' }, { name: 'input', type: 'uint256[]' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
] as const;

// ============================================================================
// API Endpoints
// ============================================================================

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_ZEROID_API_URL || 'https://api.zeroid.aethelred.network';

export const TEE_SERVICE_URL =
  process.env.NEXT_PUBLIC_TEE_SERVICE_URL || 'https://tee.zeroid.aethelred.network';

// ============================================================================
// Credential Schemas
// ============================================================================

/**
 * Well-known credential schema identifiers.
 * These are keccak-256 hashes of the canonical schema names.
 */
export const CREDENTIAL_SCHEMAS = {
  /** Government-issued identity document */
  GOVERNMENT_ID: '0x1a2b3c4d5e6f708192a3b4c5d6e7f80910111213141516171819202122232425' as Bytes32,
  /** Age verification (proves age >= threshold) */
  AGE_VERIFICATION: '0x2b3c4d5e6f708192a3b4c5d6e7f8091011121314151617181920212223242526' as Bytes32,
  /** Proof of residency */
  RESIDENCY: '0x3c4d5e6f708192a3b4c5d6e7f809101112131415161718192021222324252627' as Bytes32,
  /** Credit tier assessment */
  CREDIT_TIER: '0x4d5e6f708192a3b4c5d6e7f80910111213141516171819202122232425262728' as Bytes32,
  /** KYC/AML compliance status */
  KYC_AML: '0x5e6f708192a3b4c5d6e7f8091011121314151617181920212223242526272829' as Bytes32,
  /** Professional certification */
  PROFESSIONAL_CERT: '0x6f708192a3b4c5d6e7f809101112131415161718192021222324252627282930' as Bytes32,
  /** Educational degree */
  EDUCATION: '0x708192a3b4c5d6e7f80910111213141516171819202122232425262728293031' as Bytes32,
  /** Employment verification */
  EMPLOYMENT: '0x8192a3b4c5d6e7f8091011121314151617181920212223242526272829303132' as Bytes32,
} as const;

/** Human-readable labels for credential schemas */
export const SCHEMA_LABELS: Record<string, string> = {
  [CREDENTIAL_SCHEMAS.GOVERNMENT_ID]: 'Government ID',
  [CREDENTIAL_SCHEMAS.AGE_VERIFICATION]: 'Age Verification',
  [CREDENTIAL_SCHEMAS.RESIDENCY]: 'Proof of Residency',
  [CREDENTIAL_SCHEMAS.CREDIT_TIER]: 'Credit Tier',
  [CREDENTIAL_SCHEMAS.KYC_AML]: 'KYC/AML Compliance',
  [CREDENTIAL_SCHEMAS.PROFESSIONAL_CERT]: 'Professional Certification',
  [CREDENTIAL_SCHEMAS.EDUCATION]: 'Educational Degree',
  [CREDENTIAL_SCHEMAS.EMPLOYMENT]: 'Employment Verification',
};

// ============================================================================
// Attribute Types
// ============================================================================

/** Standard attribute keys used across credential schemas */
export const ATTRIBUTE_KEYS = {
  // Personal
  FULL_NAME: 'fullName',
  DATE_OF_BIRTH: 'dateOfBirth',
  NATIONALITY: 'nationality',
  GENDER: 'gender',

  // Address / Residency
  COUNTRY: 'country',
  STATE_PROVINCE: 'stateProvince',
  CITY: 'city',
  POSTAL_CODE: 'postalCode',

  // Identity Document
  DOCUMENT_TYPE: 'documentType',
  DOCUMENT_NUMBER: 'documentNumber',
  ISSUING_AUTHORITY: 'issuingAuthority',
  ISSUE_DATE: 'issueDate',
  EXPIRY_DATE: 'expiryDate',

  // Financial
  CREDIT_TIER: 'creditTier',
  KYC_LEVEL: 'kycLevel',
  AML_STATUS: 'amlStatus',

  // Professional
  CERTIFICATION_NAME: 'certificationName',
  CERTIFYING_BODY: 'certifyingBody',
  DEGREE_TYPE: 'degreeType',
  INSTITUTION: 'institution',
  EMPLOYER: 'employer',
  JOB_TITLE: 'jobTitle',
} as const;

/** Credit tier levels */
export enum CreditTier {
  Prime = 'prime',
  NearPrime = 'near_prime',
  Subprime = 'subprime',
  DeepSubprime = 'deep_subprime',
  Unscored = 'unscored',
}

/** KYC verification levels */
export enum KYCLevel {
  None = 0,
  Basic = 1,
  Enhanced = 2,
  Full = 3,
}

// ============================================================================
// ZK Circuit Configuration
// ============================================================================

/** Well-known circuit identifiers */
export const CIRCUIT_IDS = {
  AGE_PROOF: '0xage0000000000000000000000000000000000000000000000000000000000001' as Bytes32,
  RESIDENCY_PROOF: '0xres0000000000000000000000000000000000000000000000000000000000001' as Bytes32,
  CREDIT_TIER_PROOF: '0xcrd0000000000000000000000000000000000000000000000000000000000001' as Bytes32,
  KYC_STATUS_PROOF: '0xkyc0000000000000000000000000000000000000000000000000000000000001' as Bytes32,
  IDENTITY_OWNERSHIP: '0xidn0000000000000000000000000000000000000000000000000000000000001' as Bytes32,
} as const;

/** Circuit metadata for client-side proof generation */
export const CIRCUITS: Record<string, CircuitMeta> = {
  [CIRCUIT_IDS.AGE_PROOF]: {
    circuitId: CIRCUIT_IDS.AGE_PROOF,
    name: 'Age Proof',
    description: 'Proves age meets or exceeds a threshold without revealing date of birth',
    publicInputs: ['ageThresholdYears', 'currentTimestamp', 'credentialHashPublic'],
    privateInputs: [
      'subjectId',
      'dateOfBirth',
      'expiryTimestamp',
      'issuerPubKeyX',
      'issuerPubKeyY',
      'nonce',
      'signatureR8x',
      'signatureR8y',
      'signatureS',
    ],
    outputs: ['ageVerified', 'credentialValid'],
    wasmPath: '/circuits/age/age_proof_js/age_proof.wasm',
    zkeyPath: '/circuits/age/age_proof_final.zkey',
    vkeyPath: '/circuits/age/verification_key.json',
    estimatedProvingTimeMs: 3000,
  },
  [CIRCUIT_IDS.RESIDENCY_PROOF]: {
    circuitId: CIRCUIT_IDS.RESIDENCY_PROOF,
    name: 'Residency Proof',
    description: 'Proves residency in a specific country or region without revealing full address',
    publicInputs: ['targetCountryHash', 'currentTimestamp', 'credentialHashPublic'],
    privateInputs: [
      'subjectId',
      'country',
      'stateProvince',
      'city',
      'postalCode',
      'expiryTimestamp',
      'issuerPubKeyX',
      'issuerPubKeyY',
      'nonce',
      'signatureR8x',
      'signatureR8y',
      'signatureS',
    ],
    outputs: ['residencyVerified', 'credentialValid'],
    wasmPath: '/circuits/residency/residency_proof_js/residency_proof.wasm',
    zkeyPath: '/circuits/residency/residency_proof_final.zkey',
    vkeyPath: '/circuits/residency/verification_key.json',
    estimatedProvingTimeMs: 4000,
  },
  [CIRCUIT_IDS.CREDIT_TIER_PROOF]: {
    circuitId: CIRCUIT_IDS.CREDIT_TIER_PROOF,
    name: 'Credit Tier Proof',
    description: 'Proves credit tier meets a minimum threshold without revealing exact score',
    publicInputs: ['minTierLevel', 'currentTimestamp', 'credentialHashPublic'],
    privateInputs: [
      'subjectId',
      'creditTier',
      'assessmentDate',
      'expiryTimestamp',
      'issuerPubKeyX',
      'issuerPubKeyY',
      'nonce',
      'signatureR8x',
      'signatureR8y',
      'signatureS',
    ],
    outputs: ['tierVerified', 'credentialValid'],
    wasmPath: '/circuits/credit/credit_tier_proof_js/credit_tier_proof.wasm',
    zkeyPath: '/circuits/credit/credit_tier_proof_final.zkey',
    vkeyPath: '/circuits/credit/verification_key.json',
    estimatedProvingTimeMs: 3500,
  },
};

// ============================================================================
// TEE Configuration
// ============================================================================

/** Minimum attestation freshness by platform (seconds) */
export const TEE_FRESHNESS_REQUIREMENTS = {
  IntelSGX: 86400, // 24 hours
  AMDSEV: 86400,
  ArmTrustZone: 43200, // 12 hours
} as const;

/** Supported TEE service endpoints for biometric verification */
export const TEE_ENDPOINTS = {
  BIOMETRIC_ENROLL: '/api/v1/tee/biometric/enroll',
  BIOMETRIC_VERIFY: '/api/v1/tee/biometric/verify',
  ATTESTATION_VERIFY: '/api/v1/tee/attestation/verify',
  CREDENTIAL_ISSUE: '/api/v1/tee/credential/issue',
  NODE_STATUS: '/api/v1/tee/nodes/status',
} as const;

// ============================================================================
// UI Constants
// ============================================================================

/** Maximum number of credentials displayed per page */
export const CREDENTIALS_PAGE_SIZE = 12;

/** Maximum number of proof requests displayed per page */
export const PROOF_REQUESTS_PAGE_SIZE = 10;

/** Maximum number of governance proposals per page */
export const PROPOSALS_PAGE_SIZE = 10;

/** Proof generation timeout in milliseconds */
export const PROOF_GENERATION_TIMEOUT_MS = 60_000;

/** How often to poll for credential status updates (ms) */
export const CREDENTIAL_POLL_INTERVAL_MS = 15_000;

/** How often to refresh TEE node status (ms) */
export const TEE_NODE_POLL_INTERVAL_MS = 30_000;

/** DID method prefix */
export const DID_METHOD_PREFIX = 'did:aethelred';

/** Seconds in a year (365.25 days) — matches the circom constant */
export const SECONDS_PER_YEAR = 31_557_600;
