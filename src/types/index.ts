/**
 * ZeroID — TypeScript Type Definitions
 *
 * Comprehensive types for the ZeroID self-sovereign identity protocol.
 * Mirrors on-chain structures from IZeroID.sol and extends them with
 * frontend-specific types for ZK proofs, TEE attestation, governance,
 * and API communication.
 */

// ============================================================================
// Primitives
// ============================================================================

/** EVM-compatible hex-encoded address */
export type Address = `0x${string}`;

/** Hex-encoded bytes32 value */
export type Bytes32 = `0x${string}`;

/** Hex-encoded arbitrary-length bytes */
export type HexString = `0x${string}`;

/** ISO-8601 date string */
export type ISODateString = string;

/** Unix timestamp in seconds */
export type UnixTimestamp = number;

// ============================================================================
// Identity Types
// ============================================================================

/**
 * Decentralised Identifier conforming to the W3C DID specification.
 * ZeroID DIDs use the `did:aethelred:<network>:<hex>` scheme.
 */
export interface DID {
  /** Full DID URI, e.g. `did:aethelred:mainnet:0xabc...` */
  uri: string;
  /** Method-specific identifier (the hex portion) */
  identifier: string;
  /** Keccak-256 hash of the DID stored on-chain */
  hash: Bytes32;
  /** Network the DID is registered on */
  network: 'mainnet' | 'testnet' | 'devnet';
}

/** On-chain identity status — mirrors Solidity `IdentityStatus` enum */
export enum IdentityStatus {
  Inactive = 0,
  Active = 1,
  Suspended = 2,
  Revoked = 3,
}

/**
 * User identity profile combining on-chain registration data
 * with client-side metadata.
 */
export interface IdentityProfile {
  /** The user's DID */
  did: DID;
  /** EVM address that controls this identity */
  controller: Address;
  /** On-chain status */
  status: IdentityStatus;
  /** Hash used for social-recovery flow */
  recoveryHash: Bytes32;
  /** Number of credentials issued to this identity */
  credentialCount: number;
  /** Anti-replay nonce */
  nonce: number;
  /** When the identity was registered (Unix seconds) */
  createdAt: UnixTimestamp;
  /** When the identity was last updated (Unix seconds) */
  updatedAt: UnixTimestamp;
  /** Optional display name (client-side only, not stored on-chain) */
  displayName?: string;
  /** Optional avatar URI (client-side only) */
  avatarUri?: string;
}

/**
 * Biometric hash used for liveness verification inside a TEE.
 * The raw biometric data never leaves the enclave; only the hash
 * is transmitted to the client.
 */
export interface BiometricHash {
  /** Keccak-256 hash of the biometric template */
  hash: Bytes32;
  /** Type of biometric captured */
  biometricType: BiometricType;
  /** TEE enclave that produced this hash */
  enclaveHash: Bytes32;
  /** When the biometric was captured (Unix seconds) */
  capturedAt: UnixTimestamp;
  /** How long the biometric hash is considered fresh (seconds) */
  freshnessTtl: number;
}

/** Supported biometric modalities */
export enum BiometricType {
  Fingerprint = 'fingerprint',
  FaceRecognition = 'face_recognition',
  IrisScan = 'iris_scan',
  VoicePrint = 'voice_print',
}

// ============================================================================
// Credential Types
// ============================================================================

/** On-chain credential lifecycle state — mirrors Solidity `CredentialStatus` */
export enum CredentialStatus {
  None = 0,
  Active = 1,
  Suspended = 2,
  Revoked = 3,
  Expired = 4,
}

/**
 * A verifiable credential issued by a trusted issuer to a subject.
 * Attributes are stored as a Merkle tree; the root is committed on-chain.
 */
export interface Credential {
  /** Unique credential identifier (keccak-256) */
  hash: Bytes32;
  /** Schema this credential conforms to */
  schemaHash: Bytes32;
  /** DID of the issuer */
  issuerDid: DID;
  /** DID of the credential subject */
  subjectDid: DID;
  /** When the credential was issued (Unix seconds) */
  issuedAt: UnixTimestamp;
  /** When the credential expires (Unix seconds) */
  expiresAt: UnixTimestamp;
  /** Current lifecycle status */
  status: CredentialStatus;
  /** Merkle root of the credential's attribute tree */
  merkleRoot: Bytes32;
  /** Human-readable name of the schema */
  schemaName?: string;
  /** Decoded attributes (available client-side when user decrypts) */
  attributes?: CredentialAttribute[];
}

/**
 * A single key-value attribute inside a credential.
 * Stored as leaves in the credential's Merkle tree.
 */
export interface CredentialAttribute {
  /** Attribute key, e.g. "dateOfBirth", "nationality" */
  key: string;
  /** Attribute value (string-encoded) */
  value: string;
  /** Keccak-256 hash of `key || value` (Merkle leaf) */
  hash: Bytes32;
}

/**
 * Schema definition governing credential structure.
 * Must be approved through governance before issuers can use it.
 */
export interface CredentialSchema {
  /** Keccak-256 hash of the schema */
  schemaHash: Bytes32;
  /** Human-readable schema name */
  name: string;
  /** Address that proposed the schema */
  proposer: Address;
  /** When the schema was created (Unix seconds) */
  createdAt: UnixTimestamp;
  /** Whether the schema is currently active */
  isActive: boolean;
  /** Hashes of permitted attribute keys */
  attributeHashes: Bytes32[];
  /** Human-readable attribute definitions (frontend only) */
  attributes?: SchemaAttribute[];
}

/** Defines a single attribute within a credential schema */
export interface SchemaAttribute {
  /** Attribute key name */
  key: string;
  /** Expected value type */
  valueType: 'string' | 'number' | 'boolean' | 'date' | 'bytes32';
  /** Whether this attribute is required in the credential */
  required: boolean;
  /** Human-readable description */
  description?: string;
}

/**
 * Proof that a specific attribute exists in a credential's Merkle tree
 * without revealing other attributes.
 */
export interface AttributeProof {
  /** The credential this proof relates to */
  credentialHash: Bytes32;
  /** Hash of the attribute being proved */
  attributeHash: Bytes32;
  /** Merkle proof siblings */
  merkleProof: Bytes32[];
  /** Index of the leaf in the tree */
  leafIndex: number;
  /** The attribute value (disclosed only if the user opts in) */
  disclosedValue?: string;
}

// ============================================================================
// ZK Proof Types
// ============================================================================

/** Supported ZK proof systems */
export enum ProofSystem {
  Groth16 = 'groth16',
  PLONK = 'plonk',
  FFLONK = 'fflonk',
}

/**
 * Groth16 proof structure matching the on-chain `Groth16Proof` struct.
 * All values are hex-encoded uint256.
 */
export interface Groth16Proof {
  /** Point A on G1 [x, y] */
  a: [string, string];
  /** Point B on G2 [[x1, x2], [y1, y2]] */
  b: [[string, string], [string, string]];
  /** Point C on G1 [x, y] */
  c: [string, string];
}

/**
 * Complete ZK proof bundle including metadata.
 * Generated client-side using snarkjs WASM.
 */
export interface ZKProof {
  /** Unique proof identifier */
  id: string;
  /** The circuit used to generate this proof */
  circuitId: Bytes32;
  /** Human-readable circuit name */
  circuitName: string;
  /** Proof system used */
  proofSystem: ProofSystem;
  /** The Groth16 proof data */
  proof: Groth16Proof;
  /** Public inputs to the circuit */
  publicInputs: string[];
  /** Public outputs from the circuit */
  publicOutputs: string[];
  /** When the proof was generated (Unix seconds) */
  generatedAt: UnixTimestamp;
  /** How long the proof is valid (seconds, 0 = forever) */
  validityDuration: number;
  /** Keccak-256 hash of the serialised proof */
  proofHash: Bytes32;
}

/**
 * A request for a ZK proof from a verifier to a holder.
 * Specifies which circuit and public inputs are expected.
 */
export interface ProofRequest {
  /** Unique request identifier */
  id: string;
  /** The circuit the verifier expects */
  circuitId: Bytes32;
  /** Human-readable circuit name */
  circuitName: string;
  /** Public inputs the verifier will supply */
  publicInputs: Record<string, string>;
  /** DID of the entity requesting the proof */
  verifierDid: DID;
  /** Why the proof is being requested */
  purpose: string;
  /** When the request expires (Unix seconds) */
  expiresAt: UnixTimestamp;
  /** Whether the request has been fulfilled */
  fulfilled: boolean;
  /** When the request was created (Unix seconds) */
  createdAt: UnixTimestamp;
}

/**
 * Result of verifying a ZK proof, either on-chain or client-side.
 */
export interface ProofVerification {
  /** Whether the proof is valid */
  valid: boolean;
  /** The proof that was verified */
  proofHash: Bytes32;
  /** The circuit used */
  circuitId: Bytes32;
  /** When verification occurred (Unix seconds) */
  verifiedAt: UnixTimestamp;
  /** On-chain transaction hash (if verified on-chain) */
  txHash?: HexString;
  /** Error message (if verification failed) */
  error?: string;
}

// ============================================================================
// TEE Types
// ============================================================================

/** TEE platform type — mirrors Solidity `TEEPlatform` enum */
export enum TEEPlatform {
  Unknown = 0,
  IntelSGX = 1,
  AMDSEV = 2,
  ArmTrustZone = 3,
}

/** Attestation type for TEE verification */
export enum AttestationType {
  /** Remote attestation via Intel IAS or DCAP */
  Remote = 'remote',
  /** Local attestation within the same platform */
  Local = 'local',
  /** Self-attestation (development only) */
  Self = 'self',
}

/**
 * TEE attestation report from a trusted enclave.
 * Mirrors the on-chain `AttestationReport` struct with additional metadata.
 */
export interface TEEAttestation {
  /** Keccak-256 hash of the enclave code */
  enclaveHash: Bytes32;
  /** TEE platform */
  platform: TEEPlatform;
  /** When the attestation was produced (Unix seconds) */
  attestedAt: UnixTimestamp;
  /** When the attestation expires (Unix seconds) */
  expiresAt: UnixTimestamp;
  /** Hash of the report payload */
  reportDataHash: Bytes32;
  /** Operator address that submitted the attestation */
  nodeOperator: Address;
  /** Whether the attestation is currently valid */
  isValid: boolean;
  /** Attestation type */
  attestationType: AttestationType;
  /** Raw attestation signature (hex) */
  signature?: HexString;
}

/**
 * A TEE node in the ZeroID network that can process
 * biometric verification and credential issuance inside an enclave.
 */
export interface TEENode {
  /** Unique node identifier */
  id: string;
  /** Node operator address */
  operator: Address;
  /** Latest attestation for this node */
  attestation: TEEAttestation;
  /** TEE platform */
  platform: TEEPlatform;
  /** Human-readable label */
  name: string;
  /** Geographic region */
  region: string;
  /** Whether the node is currently accepting requests */
  isOnline: boolean;
  /** Node uptime percentage (0-100) */
  uptimePercent: number;
  /** Total verifications processed */
  verificationsProcessed: number;
  /** Average response latency in milliseconds */
  avgLatencyMs: number;
}

// ============================================================================
// Governance Types
// ============================================================================

/** On-chain proposal state — mirrors Solidity `ProposalState` enum */
export enum ProposalState {
  Pending = 0,
  Active = 1,
  Defeated = 2,
  Succeeded = 3,
  Queued = 4,
  Executed = 5,
  Cancelled = 6,
}

/** Types of governance proposals */
export enum ProposalType {
  SchemaApproval = 'schema_approval',
  SchemaRevocation = 'schema_revocation',
  IssuerApproval = 'issuer_approval',
  IssuerRemoval = 'issuer_removal',
  ParameterChange = 'parameter_change',
}

/**
 * A governance proposal in the ZeroID DAO.
 */
export interface Proposal {
  /** On-chain proposal ID */
  id: number;
  /** Type of proposal */
  type: ProposalType;
  /** Current state */
  state: ProposalState;
  /** Address that created the proposal */
  proposer: Address;
  /** Hash of the target (schema or issuer DID) */
  targetHash: Bytes32;
  /** Human-readable title */
  title: string;
  /** Detailed description */
  description: string;
  /** Total votes in favour */
  forVotes: bigint;
  /** Total votes against */
  againstVotes: bigint;
  /** Total abstain votes */
  abstainVotes: bigint;
  /** Block number when voting starts */
  startBlock: number;
  /** Block number when voting ends */
  endBlock: number;
  /** When the proposal was created (Unix seconds) */
  createdAt: UnixTimestamp;
  /** When the proposal was executed (Unix seconds, 0 if not executed) */
  executedAt?: UnixTimestamp;
}

/**
 * A single vote cast on a governance proposal.
 */
export interface Vote {
  /** Proposal being voted on */
  proposalId: number;
  /** Voter address */
  voter: Address;
  /** Whether the vote is in support */
  support: boolean;
  /** Voting weight (based on token balance / delegation) */
  weight: bigint;
  /** Optional reason for the vote */
  reason?: string;
  /** When the vote was cast (Unix seconds) */
  castAt: UnixTimestamp;
  /** Transaction hash */
  txHash?: HexString;
}

/**
 * A proposal specifically for adding a new credential schema.
 * Extends the base Proposal with schema-specific fields.
 */
export interface SchemaProposal extends Proposal {
  type: ProposalType.SchemaApproval | ProposalType.SchemaRevocation;
  /** The schema being proposed */
  schema: CredentialSchema;
}

// ============================================================================
// Verification Types
// ============================================================================

/** Status of a verification request */
export enum VerificationStatus {
  Pending = 'pending',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed',
  Expired = 'expired',
}

/**
 * A request from a verifier to check a user's credentials
 * or attributes using ZK proofs.
 */
export interface VerificationRequest {
  /** Unique request identifier */
  id: string;
  /** DID of the verifier making the request */
  verifierDid: DID;
  /** DID of the subject being verified */
  subjectDid: DID;
  /** Credential hash to verify against */
  credentialHash: Bytes32;
  /** Which attributes to selectively disclose */
  requestedAttributes: string[];
  /** Circuit to use for proof generation */
  circuitId: Bytes32;
  /** Current status */
  status: VerificationStatus;
  /** When the request was created (Unix seconds) */
  createdAt: UnixTimestamp;
  /** When the request expires (Unix seconds) */
  expiresAt: UnixTimestamp;
  /** Purpose / reason for the verification */
  purpose: string;
  /** Whether the user has consented to this verification */
  userConsent: boolean;
}

/**
 * The result of a completed verification.
 */
export interface VerificationResult {
  /** The request this result corresponds to */
  requestId: string;
  /** Whether verification succeeded */
  verified: boolean;
  /** The ZK proof used */
  proof?: ZKProof;
  /** Per-attribute verification results */
  attributeResults: AttributeVerificationResult[];
  /** When verification completed (Unix seconds) */
  verifiedAt: UnixTimestamp;
  /** On-chain transaction hash (if submitted on-chain) */
  txHash?: HexString;
  /** Error message if verification failed */
  error?: string;
}

/** Result for a single attribute within a verification */
export interface AttributeVerificationResult {
  /** Attribute key */
  attributeKey: string;
  /** Whether this specific attribute was verified */
  verified: boolean;
  /** Disclosed value (only if user consented to disclosure) */
  disclosedValue?: string;
}

/**
 * Configuration for selective disclosure — specifies which attributes
 * to reveal and which to prove with ZK.
 */
export interface SelectiveDisclosure {
  /** Credential to disclose from */
  credentialHash: Bytes32;
  /** Attributes to fully reveal (key + value) */
  revealedAttributes: string[];
  /** Attributes to prove via ZK without revealing the value */
  provenAttributes: ProvenAttribute[];
  /** Merkle proofs for each disclosed attribute */
  merkleProofs: Record<string, Bytes32[]>;
}

/**
 * An attribute proven via ZK without revealing the actual value.
 * E.g., prove age >= 18 without revealing date of birth.
 */
export interface ProvenAttribute {
  /** Attribute key being proven */
  key: string;
  /** Type of proof (range, equality, membership, etc.) */
  proofType: AttributeProofType;
  /** Public threshold or comparison value */
  publicValue?: string;
  /** ZK circuit used for this attribute proof */
  circuitId: Bytes32;
}

/** Types of attribute proofs */
export enum AttributeProofType {
  /** Prove attribute >= threshold */
  RangeGte = 'range_gte',
  /** Prove attribute <= threshold */
  RangeLte = 'range_lte',
  /** Prove attribute == value (without revealing attribute) */
  Equality = 'equality',
  /** Prove attribute is in a set */
  SetMembership = 'set_membership',
  /** Prove attribute is NOT in a set */
  SetNonMembership = 'set_non_membership',
  /** Prove attribute exists in the credential */
  Existence = 'existence',
}

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Standard API response envelope.
 * All ZeroID backend endpoints return this structure.
 */
export interface ApiResponse<T = unknown> {
  /** Whether the request succeeded */
  success: boolean;
  /** Response payload (present on success) */
  data?: T;
  /** Error information (present on failure) */
  error?: ApiError;
  /** ISO-8601 timestamp of the response */
  timestamp: ISODateString;
  /** Request trace ID for debugging */
  requestId: string;
}

/** Structured API error */
export interface ApiError {
  /** Machine-readable error code */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Additional error context */
  details?: Record<string, unknown>;
}

/** Paginated list response */
export interface PaginatedResponse<T> {
  /** Items in the current page */
  items: T[];
  /** Total number of items across all pages */
  total: number;
  /** Current page number (1-indexed) */
  page: number;
  /** Items per page */
  pageSize: number;
  /** Whether there are more pages */
  hasMore: boolean;
}

/** Health check response from the backend */
export interface HealthResponse {
  /** Service status */
  status: 'healthy' | 'degraded' | 'down';
  /** Service version */
  version: string;
  /** Individual component health */
  components: {
    database: ComponentHealth;
    blockchain: ComponentHealth;
    teeNetwork: ComponentHealth;
    proofService: ComponentHealth;
  };
  /** Server uptime in seconds */
  uptime: number;
}

/** Health status of an individual backend component */
export interface ComponentHealth {
  /** Whether the component is operational */
  healthy: boolean;
  /** Response latency in milliseconds */
  latencyMs: number;
  /** Optional status message */
  message?: string;
}

// ============================================================================
// Client State Types (used by React contexts)
// ============================================================================

/** State shape for the IdentityContext */
export interface IdentityState {
  /** The current user's identity profile (null if not registered) */
  profile: IdentityProfile | null;
  /** Credentials held by the current user */
  credentials: Credential[];
  /** Whether identity data is being loaded */
  isLoading: boolean;
  /** Whether the user is registered on-chain */
  isRegistered: boolean;
  /** Current error (null if none) */
  error: string | null;
}

/** State shape for the ProofContext */
export interface ProofState {
  /** Active proof requests directed at the user */
  pendingRequests: ProofRequest[];
  /** Proofs generated by the user */
  generatedProofs: ZKProof[];
  /** Verification results */
  verificationResults: VerificationResult[];
  /** Whether a proof is currently being generated */
  isGenerating: boolean;
  /** Progress percentage during proof generation (0-100) */
  generationProgress: number;
  /** Current error (null if none) */
  error: string | null;
}

// ============================================================================
// Circuit Metadata
// ============================================================================

/**
 * Metadata about a ZK circuit available for proof generation.
 */
export interface CircuitMeta {
  /** On-chain circuit identifier */
  circuitId: Bytes32;
  /** Human-readable name */
  name: string;
  /** Description of what the circuit proves */
  description: string;
  /** Names of public input signals */
  publicInputs: string[];
  /** Names of private input signals */
  privateInputs: string[];
  /** Names of output signals */
  outputs: string[];
  /** Path to the WASM proving artifact */
  wasmPath: string;
  /** Path to the zkey (proving key) */
  zkeyPath: string;
  /** Path to the verification key JSON */
  vkeyPath: string;
  /** Approximate proving time in milliseconds */
  estimatedProvingTimeMs: number;
}

// ============================================================================
// AI Agent Identity Types
// ============================================================================

export type AgentType = 'llm' | 'autonomous' | 'bot' | 'iot' | 'mpc';
export type AgentStatus = 'active' | 'suspended' | 'revoked' | 'pending_approval';

export interface AIAgent {
  id: string;
  agentDid: string;
  name: string;
  description?: string;
  operatorId: string;
  agentType: AgentType;
  capabilities: AgentCapability[];
  delegationChain?: AgentDelegation[];
  maxDelegationDepth: number;
  reputationScore: number;
  status: AgentStatus;
  humanApprovalRequired: boolean;
  rateLimitPerMinute: number;
  lastActiveAt?: ISODateString;
  createdAt: ISODateString;
}

export interface AgentCapability {
  id: string;
  name: string;
  description: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  constraints?: Record<string, unknown>;
}

export interface AgentDelegation {
  fromAgentId: string;
  toAgentId: string;
  capabilities: string[];
  constraints: Record<string, unknown>;
  expiresAt: ISODateString;
  isActive: boolean;
}

export interface AgentAction {
  id: string;
  agentId: string;
  actionType: string;
  targetResource?: string;
  riskScore: number;
  requiresApproval: boolean;
  approved?: boolean;
  approvedBy?: string;
  result?: Record<string, unknown>;
  executedAt?: ISODateString;
  createdAt: ISODateString;
}

// ============================================================================
// AI Risk & Compliance Types
// ============================================================================

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type RiskDecision = 'approve' | 'review' | 'reject' | 'escalate';

export interface RiskAssessment {
  id: string;
  entityId: string;
  entityType: string;
  compositeScore: number;
  identityRisk?: number;
  credentialRisk?: number;
  transactionRisk?: number;
  networkRisk?: number;
  behavioralRisk?: number;
  level: RiskLevel;
  factors: RiskFactor[];
  explanation: string;
  decision: RiskDecision;
  jurisdictionId?: string;
  modelVersion: string;
  assessedAt: ISODateString;
}

export interface RiskFactor {
  category: string;
  name: string;
  score: number;
  weight: number;
  description: string;
  impact: 'positive' | 'negative' | 'neutral';
}

export interface ComplianceAlert {
  id: string;
  alertType: string;
  severity: RiskLevel;
  title: string;
  description: string;
  entityId?: string;
  entityType?: string;
  actionRequired: boolean;
  acknowledged: boolean;
  resolvedAt?: ISODateString;
  createdAt: ISODateString;
}

export interface ComplianceCopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  messageType: 'text' | 'alert' | 'action' | 'report';
  actions?: CopilotAction[];
  citations?: CopilotCitation[];
  timestamp: ISODateString;
}

export interface CopilotAction {
  label: string;
  actionType: string;
  params?: Record<string, unknown>;
}

export interface CopilotCitation {
  text: string;
  source: string;
  url?: string;
}

export type ScreeningResult = 'clear' | 'potential_match' | 'confirmed_match' | 'false_positive' | 'under_review';

export interface SanctionsScreening {
  id: string;
  entityId: string;
  screeningType: string;
  queryName: string;
  result: ScreeningResult;
  matchScore?: number;
  matches?: SanctionsMatch[];
  listsChecked: string[];
  screenedAt: ISODateString;
}

export interface SanctionsMatch {
  listName: string;
  matchedName: string;
  matchScore: number;
  entityType: string;
  listingDate?: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// Regulatory & Jurisdiction Types
// ============================================================================

export interface Jurisdiction {
  code: string;
  name: string;
  region: string;
  regulatoryAuthority: string;
  requiredCredentials: string[];
  dataRetentionYears: number;
  consentRequired: boolean;
  crossBorderRestrictions: string[];
  mutualRecognition: string[];
  complianceFramework: string;
}

export interface JurisdictionCompliance {
  jurisdictionCode: string;
  complianceScore: number;
  requiredCredentials: string[];
  heldCredentials: string[];
  gaps: CredentialGap[];
  dataResidency?: string;
  lastAssessed: ISODateString;
}

export interface CredentialGap {
  credentialType: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  estimatedTimeToObtain?: string;
  suggestedIssuers?: string[];
}

export interface RegulatoryChange {
  id: string;
  jurisdiction: string;
  title: string;
  description: string;
  effectiveDate: ISODateString;
  impactLevel: RiskLevel;
  affectedCredentials: string[];
  actionItems: string[];
}

// ============================================================================
// Enterprise Integration Types
// ============================================================================

export interface APIKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  environment: 'sandbox' | 'production';
  rateLimitPerMinute: number;
  ipAllowlist: string[];
  lastUsedAt?: ISODateString;
  expiresAt?: ISODateString;
  isActive: boolean;
  createdAt: ISODateString;
}

export interface WebhookConfig {
  id: string;
  url: string;
  events: string[];
  status: 'active' | 'paused' | 'failing' | 'disabled';
  failureCount: number;
  lastDeliveredAt?: ISODateString;
  lastStatusCode?: number;
  createdAt: ISODateString;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventType: string;
  statusCode?: number;
  responseTimeMs?: number;
  attempt: number;
  success: boolean;
  deliveredAt: ISODateString;
}

export interface SLAMetrics {
  uptime: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  errorRate: number;
  proofGenerationAvgMs: number;
  teeNodeAvailability: number;
  complianceScore: number;
  period: string;
  violations: SLAViolation[];
}

export interface SLAViolation {
  id: string;
  metric: string;
  threshold: number;
  actual: number;
  occurredAt: ISODateString;
  resolvedAt?: ISODateString;
  creditAmount?: number;
}

export interface UsageMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTimeMs: number;
  topEndpoints: { endpoint: string; count: number }[];
  byDay: { date: string; count: number }[];
}

// ============================================================================
// Cross-Chain Bridge Types
// ============================================================================

export type BridgeStatus = 'initiated' | 'source_confirmed' | 'relaying' | 'destination_confirmed' | 'completed' | 'failed' | 'rolled_back';

export interface BridgeTransaction {
  id: string;
  credentialId: string;
  sourceChain: ChainInfo;
  destinationChain: ChainInfo;
  sourceAddress: Address;
  destinationAddress: Address;
  credentialHash: Bytes32;
  status: BridgeStatus;
  sourceTxHash?: string;
  destinationTxHash?: string;
  fee?: string;
  initiatedAt: ISODateString;
  completedAt?: ISODateString;
  estimatedCompletionTime?: string;
}

export interface ChainInfo {
  chainId: number;
  name: string;
  icon?: string;
  explorerUrl?: string;
  bridgeContractAddress?: Address;
}

// ============================================================================
// Marketplace Types
// ============================================================================

export interface MarketplaceIssuer {
  id: string;
  name: string;
  description?: string;
  website?: string;
  jurisdictions: string[];
  specializations: string[];
  trustScore: number;
  credentialsIssued: number;
  verificationsCompleted: number;
  averageIssuanceTimeSec?: number;
  isVerified: boolean;
}

export interface MarketplaceListing {
  id: string;
  issuerId: string;
  credentialType: string;
  title: string;
  description: string;
  price?: string;
  stakingRequired?: string;
  jurisdictions: string[];
  requirements?: Record<string, unknown>;
  estimatedTimeMin?: number;
  isActive: boolean;
}

// ============================================================================
// Analytics Types
// ============================================================================

export interface PrivacyScore {
  overall: number;
  categories: {
    dataDisclosure: number;
    zkUsage: number;
    verifierDiversity: number;
    credentialFreshness: number;
  };
  recommendations: PrivacyRecommendation[];
  networkAverage: number;
}

export interface PrivacyRecommendation {
  category: string;
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  actionType: string;
}

export interface DataExposureEvent {
  id: string;
  timestamp: ISODateString;
  verifier: string;
  attributesDisclosed: string[];
  attributesZKProved: string[];
  method: 'full_disclosure' | 'selective_disclosure' | 'zk_proof';
}

// ============================================================================
// Organization & RBAC Types
// ============================================================================

export type OrgRole = 'viewer' | 'operator' | 'admin' | 'compliance_officer' | 'auditor';

export interface Organization {
  id: string;
  name: string;
  domain?: string;
  plan: 'starter' | 'growth' | 'enterprise';
  jurisdictions: string[];
  memberCount: number;
  createdAt: ISODateString;
}

export interface OrganizationMember {
  id: string;
  identityId: string;
  displayName?: string;
  role: OrgRole;
  permissions: string[];
  joinedAt?: ISODateString;
}

// ============================================================================
// Behavioral Biometrics Types
// ============================================================================

export interface BiometricSession {
  id: string;
  type: 'face' | 'fingerprint' | 'keystroke' | 'mouse';
  status: 'capturing' | 'processing' | 'verified' | 'failed';
  confidenceScore?: number;
  livenessScore?: number;
  antiSpoofingPassed?: boolean;
  processedInTEE: boolean;
  timestamp: ISODateString;
}

// ============================================================================
// TEE Status Types (used by useTEE hook and TEEStatusPanel)
// ============================================================================

export interface TEENodeStatus {
  id: string;
  type: string;
  status: 'active' | 'degraded' | 'offline';
  health?: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  region: string;
  name?: string;
  lastSeen?: string;
}

export interface AttestationInfo {
  valid: boolean;
  lastVerified: string;
  expiresAt: string;
  enclaveHash: string;
}
