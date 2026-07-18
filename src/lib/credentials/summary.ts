import type { CredentialAttribute } from "@/types";

export type CredentialSummaryStatus =
  | "active"
  | "suspended"
  | "revoked"
  | "expired"
  | "unknown";

export type CredentialCategory =
  | "identity"
  | "kyc"
  | "accreditation"
  | "professional"
  | "education"
  | "employment"
  | "custom";

/** Exact credential fields returned by the ZeroID credential API. */
export interface CredentialListRecordDto {
  id: string;
  credentialType: string;
  issuerId: string;
  subjectId: string;
  claimsHash: string;
  proof: unknown;
  status: string;
  issuedAt: string;
  expiresAt: string | null;
}

/**
 * Holder/issuer inventory view model.
 *
 * Deliberately does not expose `issuerDid`, `schemaType`, or an on-chain
 * `hash`: none of those values are present in the listing response. The
 * backend claims commitment remains explicitly named `claimsHash` so the UI
 * cannot accidentally present it as a registry transaction or credential ID.
 */
export interface CredentialSummary {
  id: string;
  credentialType: string;
  typeLabel: string;
  category: CredentialCategory;
  issuerId: string;
  subjectId: string;
  claimsHash: string;
  proofAvailable: boolean;
  status: CredentialSummaryStatus;
  issuedAt: string;
  expiresAt: string | null;
  /**
   * Optional locally decrypted augmentation. The credential list normalizer
   * never creates this field because attributes are not in the list contract.
   */
  attributes?: CredentialAttribute[];
}

export class CredentialResponseContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialResponseContractError";
  }
}

const CREDENTIAL_CATEGORIES: Record<string, CredentialCategory> = {
  NATIONAL_ID: "identity",
  PASSPORT: "identity",
  DRIVERS_LICENSE: "identity",
  PROOF_OF_ADDRESS: "identity",
  KYC_LEVEL_1: "kyc",
  KYC_LEVEL_2: "kyc",
  KYC_LEVEL_3: "kyc",
  ACCREDITED_INVESTOR: "accreditation",
  PROFESSIONAL_LICENSE: "professional",
  EDUCATION: "education",
  EMPLOYMENT: "employment",
  CUSTOM: "custom",
};

const STATUS_MAP: Record<string, CredentialSummaryStatus> = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
  REVOKED: "revoked",
  EXPIRED: "expired",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANONICAL_SHA256_PATTERN = /^[0-9a-f]{64}$/;

const TOKEN_LABELS: Record<string, string> = {
  id: "ID",
  kyc: "KYC",
};

function requireRecord(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CredentialResponseContractError(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(
  value: unknown,
  field: keyof CredentialListRecordDto,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CredentialResponseContractError(
      `Credential response field "${field}" must be a non-empty string`,
    );
  }
  return value;
}

function requireIsoDate(
  value: unknown,
  field: "issuedAt" | "expiresAt",
): string {
  const raw = requireString(value, field);
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new CredentialResponseContractError(
      `Credential response field "${field}" must be a valid date`,
    );
  }
  return date.toISOString();
}

export function credentialTypeLabel(credentialType: string): string {
  return credentialType
    .trim()
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map(
      (token) =>
        TOKEN_LABELS[token] ?? token.charAt(0).toUpperCase() + token.slice(1),
    )
    .join(" ");
}

export function normalizeCredentialSummary(value: unknown): CredentialSummary {
  const record = requireRecord(value, "Credential response");
  if (!("proof" in record)) {
    throw new CredentialResponseContractError(
      'Credential response field "proof" is required',
    );
  }
  const id = requireString(record.id, "id");
  if (!UUID_PATTERN.test(id)) {
    throw new CredentialResponseContractError(
      'Credential response field "id" must be a UUID',
    );
  }
  const credentialType = requireString(record.credentialType, "credentialType");
  const issuerId = requireString(record.issuerId, "issuerId");
  const subjectId = requireString(record.subjectId, "subjectId");
  const claimsHash = requireString(record.claimsHash, "claimsHash");
  if (!CANONICAL_SHA256_PATTERN.test(claimsHash)) {
    throw new CredentialResponseContractError(
      'Credential response field "claimsHash" must be a canonical lowercase SHA-256 hex digest',
    );
  }
  const rawStatus = requireString(record.status, "status").toUpperCase();
  const issuedAt = requireIsoDate(record.issuedAt, "issuedAt");

  let expiresAt: string | null = null;
  if (record.expiresAt !== null && record.expiresAt !== undefined) {
    expiresAt = requireIsoDate(record.expiresAt, "expiresAt");
  }

  return {
    id,
    credentialType,
    typeLabel: credentialTypeLabel(credentialType),
    category: CREDENTIAL_CATEGORIES[credentialType.toUpperCase()] ?? "custom",
    issuerId,
    subjectId,
    claimsHash,
    proofAvailable: record.proof !== null && record.proof !== undefined,
    status: STATUS_MAP[rawStatus] ?? "unknown",
    issuedAt,
    expiresAt,
  };
}

export function normalizeCredentialSummaries(
  value: unknown,
): CredentialSummary[] {
  if (!Array.isArray(value)) {
    throw new CredentialResponseContractError(
      "Credential list response must be an array",
    );
  }

  return value.map((credential, index) => {
    try {
      return normalizeCredentialSummary(credential);
    } catch (error) {
      if (error instanceof CredentialResponseContractError) {
        throw new CredentialResponseContractError(
          `Credential list item ${index}: ${error.message}`,
        );
      }
      throw error;
    }
  });
}
