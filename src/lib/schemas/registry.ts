import type { PaginatedResponse } from "@/types";

export type SchemaGovernanceStatus =
  | "DRAFT"
  | "PROPOSED"
  | "APPROVED"
  | "DEPRECATED";

/** Exact record returned by the schema-governance registry API. */
export interface SchemaRegistryRecord {
  id: string;
  name: string;
  version: string;
  description: string;
  schemaDefinition: Record<string, unknown> & {
    properties: Record<string, unknown>;
  };
  proposedBy: string;
  status: SchemaGovernanceStatus;
  approvalVotes: number;
  rejectionVotes: number;
  voters: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SchemaRegistryPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export class SchemaRegistryResponseContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaRegistryResponseContractError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const GOVERNANCE_STATUSES = new Set<SchemaGovernanceStatus>([
  "DRAFT",
  "PROPOSED",
  "APPROVED",
  "DEPRECATED",
]);

function requireRecord(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SchemaRegistryResponseContractError(
      `${context} must be an object`,
    );
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SchemaRegistryResponseContractError(
      `Schema registry field "${field}" must be a non-empty string`,
    );
  }
  return value;
}

function requireUuid(value: unknown, field: string): string {
  const result = requireString(value, field);
  if (!UUID_PATTERN.test(result)) {
    throw new SchemaRegistryResponseContractError(
      `Schema registry field "${field}" must be a UUID`,
    );
  }
  return result;
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new SchemaRegistryResponseContractError(
      `Schema registry field "${field}" must be a non-negative integer`,
    );
  }
  return value as number;
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new SchemaRegistryResponseContractError(
      `Schema registry pagination field "${field}" must be a positive integer`,
    );
  }
  return value as number;
}

function requireIsoDate(value: unknown, field: string): string {
  const result = requireString(value, field);
  if (!ISO_DATE_PATTERN.test(result) || !Number.isFinite(Date.parse(result))) {
    throw new SchemaRegistryResponseContractError(
      `Schema registry field "${field}" must be an ISO-8601 UTC timestamp`,
    );
  }
  return new Date(result).toISOString();
}

function requireStatus(value: unknown): SchemaGovernanceStatus {
  const status = requireString(value, "status");
  if (!GOVERNANCE_STATUSES.has(status as SchemaGovernanceStatus)) {
    throw new SchemaRegistryResponseContractError(
      'Schema registry field "status" is not a recognized governance status',
    );
  }
  return status as SchemaGovernanceStatus;
}

export function normalizeSchemaRegistryRecord(
  value: unknown,
  expectedStatus?: SchemaGovernanceStatus,
): SchemaRegistryRecord {
  const record = requireRecord(value, "Schema registry response");
  const id = requireUuid(record.id, "id");
  const name = requireString(record.name, "name");
  const version = requireString(record.version, "version");
  if (!SEMVER_PATTERN.test(version)) {
    throw new SchemaRegistryResponseContractError(
      'Schema registry field "version" must use major.minor.patch format',
    );
  }
  const description = requireString(record.description, "description");
  const schemaDefinition = requireRecord(
    record.schemaDefinition,
    'Schema registry field "schemaDefinition"',
  );
  const properties = requireRecord(
    schemaDefinition.properties,
    'Schema registry field "schemaDefinition.properties"',
  );
  const proposedBy = requireUuid(record.proposedBy, "proposedBy");
  const status = requireStatus(record.status);
  if (expectedStatus && status !== expectedStatus) {
    throw new SchemaRegistryResponseContractError(
      `Schema registry returned status "${status}" while "${expectedStatus}" was requested`,
    );
  }
  const approvalVotes = requireNonNegativeInteger(
    record.approvalVotes,
    "approvalVotes",
  );
  const rejectionVotes = requireNonNegativeInteger(
    record.rejectionVotes,
    "rejectionVotes",
  );
  if (!Array.isArray(record.voters)) {
    throw new SchemaRegistryResponseContractError(
      'Schema registry field "voters" must be an array',
    );
  }
  const voters = record.voters.map((voter, index) =>
    requireUuid(voter, `voters[${index}]`),
  );

  return {
    id,
    name,
    version,
    description,
    schemaDefinition: { ...schemaDefinition, properties },
    proposedBy,
    status,
    approvalVotes,
    rejectionVotes,
    voters,
    createdAt: requireIsoDate(record.createdAt, "createdAt"),
    updatedAt: requireIsoDate(record.updatedAt, "updatedAt"),
  };
}

export function normalizeSchemaRegistryPage(
  value: unknown,
  paginationValue: unknown,
  expectedStatus?: SchemaGovernanceStatus,
): PaginatedResponse<SchemaRegistryRecord> {
  if (!Array.isArray(value)) {
    throw new SchemaRegistryResponseContractError(
      "Schema registry list response must be an array",
    );
  }

  const items = value.map((item, index) => {
    try {
      return normalizeSchemaRegistryRecord(item, expectedStatus);
    } catch (error) {
      if (error instanceof SchemaRegistryResponseContractError) {
        throw new SchemaRegistryResponseContractError(
          `Schema registry list item ${index}: ${error.message}`,
        );
      }
      throw error;
    }
  });

  const pagination = requireRecord(
    paginationValue,
    "Schema registry pagination",
  );
  const page = requirePositiveInteger(pagination.page, "page");
  const limit = requirePositiveInteger(pagination.limit, "limit");
  if (limit > 100) {
    throw new SchemaRegistryResponseContractError(
      'Schema registry pagination field "limit" cannot exceed 100',
    );
  }
  const total = requireNonNegativeInteger(pagination.total, "total");
  const totalPages = requireNonNegativeInteger(
    pagination.totalPages,
    "totalPages",
  );
  const calculatedTotalPages = Math.ceil(total / limit);

  if (totalPages !== calculatedTotalPages) {
    throw new SchemaRegistryResponseContractError(
      'Schema registry pagination field "totalPages" is inconsistent with total and limit',
    );
  }
  if (items.length > limit || items.length > total) {
    throw new SchemaRegistryResponseContractError(
      "Schema registry pagination is inconsistent with the returned items",
    );
  }

  return {
    items,
    total,
    page,
    pageSize: limit,
    hasMore: page < totalPages,
  };
}
