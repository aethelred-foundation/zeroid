import crypto from 'crypto';
import { prisma, redis } from '../../index';

const RECEIPT_TTL_SECONDS = 90 * 24 * 60 * 60;
const RECEIPT_INDEX_LIMIT = 200;

export type PolicyReceiptType =
  | 'compliance_evaluation'
  | 'regulatory_report'
  | 'cross_border_assessment'
  | 'privacy_impact_assessment'
  | 'breach_notification'
  | 'sanctions_screening';

export interface PolicyDecisionReceipt {
  receiptId: string;
  organizationId: string;
  actorIdentityId: string;
  receiptType: PolicyReceiptType;
  policyName: string;
  policyVersion: string;
  policyDefinitionId?: string;
  policyReference?: string;
  policyApprovedByIdentityId?: string;
  policyEffectiveFrom?: string;
  policyExpiresAt?: string;
  policyGovernanceProfileId?: string;
  policyGovernanceProfileLabel?: string;
  policyGovernanceRationale?: string[];
  subjectEntityId?: string;
  policyExceptionIds: string[];
  policyExceptionCount: number;
  jurisdictionCodes: string[];
  decisionSummary: string;
  inputDigest: string;
  outputDigest: string;
  evidenceDigest: string;
  integrityHash: string;
  integrityToken: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
}

export interface CreatePolicyDecisionReceiptInput {
  organizationId: string;
  actorIdentityId: string;
  receiptType: PolicyReceiptType;
  policyName: string;
  policyVersion?: string;
  policyDefinitionId?: string;
  policyReference?: string;
  policyApprovedByIdentityId?: string;
  policyEffectiveFrom?: string;
  policyExpiresAt?: string;
  policyGovernanceProfileId?: string;
  policyGovernanceProfileLabel?: string;
  policyGovernanceRationale?: string[];
  subjectEntityId?: string;
  policyExceptionIds?: string[];
  jurisdictionCodes?: string[];
  decisionSummary: string;
  input: unknown;
  output: unknown;
  evidence?: unknown;
  metadata?: Record<string, unknown>;
}

export interface PolicyDecisionReceiptListItem {
  receiptId: string;
  receiptType: PolicyReceiptType;
  policyName: string;
  policyVersion: string;
  subjectEntityId?: string;
  decisionSummary: string;
  createdAt: string;
}

export interface PolicyDecisionReceiptExport {
  formatVersion: 'zeroid.policy_receipt_export.v1';
  exportedAt: string;
  verified: boolean;
  receipt: PolicyDecisionReceipt;
  lineage?: {
    policy?: {
      policyDefinitionId: string;
      status: string;
      policyName: string;
      policyVersion: string;
      policyReference?: string;
      approvedByIdentityId?: string | null;
      effectiveFrom?: string;
      expiresAt?: string;
      governanceProfileId?: string | null;
      governanceProfileLabel?: string | null;
      governanceProfileRationale?: string[];
      deprecatedAt?: string;
      deprecatedByIdentityId?: string | null;
      deprecationReason?: string | null;
      supersededByPolicyDefinitionId?: string | null;
      revokedAt?: string;
      revokedByIdentityId?: string | null;
      revocationReason?: string | null;
    };
    exceptions: Array<{
      exceptionId: string;
      status: string;
      policyName: string;
      policyVersion: string;
      policyReference: string;
      governanceProfileId?: string | null;
      governanceProfileLabel?: string | null;
      governanceProfileRationale?: string[];
      subjectEntityId?: string;
      scope: string;
      approvedByIdentityId?: string | null;
      effectiveFrom?: string;
      expiresAt?: string;
      revokedAt?: string;
      revokedByIdentityId?: string | null;
      revocationReason?: string | null;
    }>;
  };
}

export class PolicyDecisionReceiptError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'PolicyDecisionReceiptError';
  }
}

export class PolicyDecisionReceiptService {
  async createReceipt(input: CreatePolicyDecisionReceiptInput): Promise<PolicyDecisionReceipt> {
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + RECEIPT_TTL_SECONDS * 1000);
    const receiptId = `pdr_${crypto.randomUUID()}`;
    const policyExceptionIds = this.normalizePolicyExceptionIds(input.policyExceptionIds);

    const inputDigest = this.sha256(this.canonicalize(input.input));
    const outputDigest = this.sha256(this.canonicalize(input.output));
    const evidenceDigest = this.sha256(this.canonicalize(input.evidence ?? []));

    const integrityHash = this.computeIntegrityHash({
      receiptId,
      organizationId: input.organizationId,
      actorIdentityId: input.actorIdentityId,
      receiptType: input.receiptType,
      policyName: input.policyName,
      policyVersion: input.policyVersion ?? 'v1',
      policyDefinitionId: input.policyDefinitionId ?? null,
      policyReference: input.policyReference ?? null,
      policyApprovedByIdentityId: input.policyApprovedByIdentityId ?? null,
      policyEffectiveFrom: input.policyEffectiveFrom ?? null,
      policyExpiresAt: input.policyExpiresAt ?? null,
      policyGovernanceProfileId: input.policyGovernanceProfileId ?? null,
      policyGovernanceProfileLabel: input.policyGovernanceProfileLabel ?? null,
      policyGovernanceRationale: this.normalizeGovernanceRationale(input.policyGovernanceRationale),
      subjectEntityId: input.subjectEntityId ?? null,
      policyExceptionIds,
      policyExceptionCount: policyExceptionIds.length,
      jurisdictionCodes: input.jurisdictionCodes ?? [],
      decisionSummary: input.decisionSummary,
      inputDigest,
      outputDigest,
      evidenceDigest,
      metadata: input.metadata ?? null,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    const receipt: PolicyDecisionReceipt = {
      receiptId,
      organizationId: input.organizationId,
      actorIdentityId: input.actorIdentityId,
      receiptType: input.receiptType,
      policyName: input.policyName,
      policyVersion: input.policyVersion ?? 'v1',
      policyDefinitionId: input.policyDefinitionId,
      policyReference: input.policyReference,
      policyApprovedByIdentityId: input.policyApprovedByIdentityId,
      policyEffectiveFrom: input.policyEffectiveFrom,
      policyExpiresAt: input.policyExpiresAt,
      policyGovernanceProfileId: input.policyGovernanceProfileId,
      policyGovernanceProfileLabel: input.policyGovernanceProfileLabel,
      ...(input.policyGovernanceRationale && input.policyGovernanceRationale.length > 0
        ? { policyGovernanceRationale: this.normalizeGovernanceRationale(input.policyGovernanceRationale) }
        : {}),
      subjectEntityId: input.subjectEntityId,
      policyExceptionIds,
      policyExceptionCount: policyExceptionIds.length,
      jurisdictionCodes: input.jurisdictionCodes ?? [],
      decisionSummary: input.decisionSummary,
      inputDigest,
      outputDigest,
      evidenceDigest,
      integrityHash,
      integrityToken: this.signIntegrityHash(integrityHash),
      metadata: input.metadata,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    await this.persistLedgerReceipt(receipt);
    await redis.set(this.receiptKey(receiptId), JSON.stringify(receipt), 'EX', RECEIPT_TTL_SECONDS);
    await this.updateOrganizationIndex(input.organizationId, {
      receiptId,
      receiptType: input.receiptType,
      policyName: input.policyName,
      policyVersion: receipt.policyVersion,
      subjectEntityId: input.subjectEntityId,
      decisionSummary: input.decisionSummary,
      createdAt: receipt.createdAt,
    });

    await prisma.auditLog.create({
      data: {
        identityId: input.actorIdentityId,
        action: 'VERIFICATION_COMPLETED',
        resourceType: 'policy_decision_receipt',
        resourceId: receiptId,
        details: {
          organizationId: input.organizationId,
          receiptType: input.receiptType,
          policyName: input.policyName,
          policyVersion: receipt.policyVersion,
          policyDefinitionId: input.policyDefinitionId ?? null,
          policyReference: input.policyReference ?? null,
          policyApprovedByIdentityId: input.policyApprovedByIdentityId ?? null,
          policyEffectiveFrom: input.policyEffectiveFrom ?? null,
          policyExpiresAt: input.policyExpiresAt ?? null,
          policyGovernanceProfileId: input.policyGovernanceProfileId ?? null,
          policyGovernanceProfileLabel: input.policyGovernanceProfileLabel ?? null,
          policyGovernanceRationale: this.normalizeGovernanceRationale(input.policyGovernanceRationale),
          subjectEntityId: input.subjectEntityId ?? null,
          policyExceptionIds,
          policyExceptionCount: policyExceptionIds.length,
          jurisdictionCodes: input.jurisdictionCodes ?? [],
          decisionSummary: input.decisionSummary,
        },
      },
    });

    return receipt;
  }

  async getReceipt(receiptId: string): Promise<PolicyDecisionReceipt | null> {
    const raw = await redis.get(this.receiptKey(receiptId));
    if (raw) {
      return this.normalizeReceipt(JSON.parse(raw) as PolicyDecisionReceipt);
    }

    const ledgerModel = this.getLedgerModel();
    if (!ledgerModel) {
      return null;
    }

    const record = await ledgerModel.findUnique({
      where: { receiptId },
    });
    if (!record) {
      return null;
    }

    const receipt = this.formatLedgerReceipt(record);
    await redis.set(this.receiptKey(receiptId), JSON.stringify(receipt), 'EX', RECEIPT_TTL_SECONDS);
    return receipt;
  }

  async listReceipts(
    organizationId: string,
    limit = 25,
  ): Promise<PolicyDecisionReceiptListItem[]> {
    const boundedLimit = Math.min(RECEIPT_INDEX_LIMIT, Math.max(1, limit));
    const ledgerModel = this.getLedgerModel();
    if (ledgerModel) {
      const records = await ledgerModel.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: boundedLimit,
        select: {
          receiptId: true,
          receiptType: true,
          policyName: true,
          policyVersion: true,
          subjectEntityId: true,
          decisionSummary: true,
          createdAt: true,
        },
      });

      return records.map((record: any) => ({
        receiptId: record.receiptId,
        receiptType: this.fromLedgerReceiptType(record.receiptType),
        policyName: record.policyName,
        policyVersion: record.policyVersion,
        subjectEntityId: record.subjectEntityId ?? undefined,
        decisionSummary: record.decisionSummary,
        createdAt: record.createdAt.toISOString(),
      }));
    }

    const cached = await this.readOrganizationIndex(organizationId);
    return cached.slice(0, boundedLimit);
  }

  async verifyReceipt(receiptId: string): Promise<{ valid: boolean; receipt: PolicyDecisionReceipt | null }> {
    const receipt = await this.getReceipt(receiptId);
    if (!receipt) {
      return { valid: false, receipt: null };
    }

    const expectedHash = this.computeIntegrityHash({
      receiptId: receipt.receiptId,
      organizationId: receipt.organizationId,
      actorIdentityId: receipt.actorIdentityId,
      receiptType: receipt.receiptType,
      policyName: receipt.policyName,
      policyVersion: receipt.policyVersion,
      policyDefinitionId: receipt.policyDefinitionId ?? null,
      policyReference: receipt.policyReference ?? null,
      policyApprovedByIdentityId: receipt.policyApprovedByIdentityId ?? null,
      policyEffectiveFrom: receipt.policyEffectiveFrom ?? null,
      policyExpiresAt: receipt.policyExpiresAt ?? null,
      policyGovernanceProfileId: receipt.policyGovernanceProfileId ?? null,
      policyGovernanceProfileLabel: receipt.policyGovernanceProfileLabel ?? null,
      policyGovernanceRationale: this.normalizeGovernanceRationale(receipt.policyGovernanceRationale),
      subjectEntityId: receipt.subjectEntityId ?? null,
      policyExceptionIds: receipt.policyExceptionIds,
      policyExceptionCount: receipt.policyExceptionCount,
      jurisdictionCodes: receipt.jurisdictionCodes,
      decisionSummary: receipt.decisionSummary,
      inputDigest: receipt.inputDigest,
      outputDigest: receipt.outputDigest,
      evidenceDigest: receipt.evidenceDigest,
      metadata: receipt.metadata ?? null,
      createdAt: receipt.createdAt,
      expiresAt: receipt.expiresAt,
    });
    const expectedToken = this.signIntegrityHash(expectedHash);
    return {
      valid: this.safeCompare(expectedHash, receipt.integrityHash)
        && this.safeCompare(expectedToken, receipt.integrityToken),
      receipt,
    };
  }

  async exportReceipt(receiptId: string): Promise<PolicyDecisionReceiptExport | null> {
    const verification = await this.verifyReceipt(receiptId);
    if (!verification.receipt) {
      return null;
    }

    const lineage = await this.buildLineageSnapshot(verification.receipt);

    return {
      formatVersion: 'zeroid.policy_receipt_export.v1',
      exportedAt: new Date().toISOString(),
      verified: verification.valid,
      receipt: verification.receipt,
      ...(lineage ? { lineage } : {}),
    };
  }

  private async updateOrganizationIndex(
    organizationId: string,
    item: PolicyDecisionReceiptListItem,
  ): Promise<void> {
    const existing = await this.readOrganizationIndex(organizationId);
    const next = [item, ...existing].slice(0, RECEIPT_INDEX_LIMIT);
    await redis.set(this.organizationIndexKey(organizationId), JSON.stringify(next), 'EX', RECEIPT_TTL_SECONDS);
  }

  private async readOrganizationIndex(
    organizationId: string,
  ): Promise<PolicyDecisionReceiptListItem[]> {
    const raw = await redis.get(this.organizationIndexKey(organizationId));
    if (!raw) {
      return [];
    }
    return JSON.parse(raw) as PolicyDecisionReceiptListItem[];
  }

  private async persistLedgerReceipt(receipt: PolicyDecisionReceipt): Promise<void> {
    const ledgerModel = this.getLedgerModel();
    if (!ledgerModel) {
      return;
    }

    await ledgerModel.create({
      data: {
        receiptId: receipt.receiptId,
        organizationId: receipt.organizationId,
        actorIdentityId: receipt.actorIdentityId,
        receiptType: this.toLedgerReceiptType(receipt.receiptType),
        policyName: receipt.policyName,
        policyVersion: receipt.policyVersion,
        policyDefinitionId: receipt.policyDefinitionId,
        policyReference: receipt.policyReference,
        policyApprovedByIdentityId: receipt.policyApprovedByIdentityId,
        policyEffectiveFrom: receipt.policyEffectiveFrom ? new Date(receipt.policyEffectiveFrom) : null,
        policyExpiresAt: receipt.policyExpiresAt ? new Date(receipt.policyExpiresAt) : null,
        policyGovernanceProfileId: receipt.policyGovernanceProfileId,
        policyGovernanceProfileLabel: receipt.policyGovernanceProfileLabel,
        policyGovernanceRationale: this.normalizeGovernanceRationale(receipt.policyGovernanceRationale),
        subjectEntityId: receipt.subjectEntityId,
        policyExceptionIds: receipt.policyExceptionIds,
        policyExceptionCount: receipt.policyExceptionCount,
        jurisdictionCodes: receipt.jurisdictionCodes,
        decisionSummary: receipt.decisionSummary,
        inputDigest: receipt.inputDigest,
        outputDigest: receipt.outputDigest,
        evidenceDigest: receipt.evidenceDigest,
        integrityHash: receipt.integrityHash,
        integrityToken: receipt.integrityToken,
        metadata: receipt.metadata,
        createdAt: new Date(receipt.createdAt),
        expiresAt: new Date(receipt.expiresAt),
      },
    });
  }

  private receiptKey(receiptId: string): string {
    return `policy:receipt:${receiptId}`;
  }

  private organizationIndexKey(organizationId: string): string {
    return `policy:receipt:index:${organizationId}`;
  }

  private getLedgerModel(): any {
    return (prisma as any).policyDecisionLedger;
  }

  private toLedgerReceiptType(receiptType: PolicyReceiptType): string {
    return receiptType.toUpperCase();
  }

  private fromLedgerReceiptType(receiptType: string): PolicyReceiptType {
    return receiptType.toLowerCase() as PolicyReceiptType;
  }

  private signIntegrityHash(integrityHash: string): string {
    const secret = this.getSigningSecret();
    return crypto.createHmac('sha256', secret).update(integrityHash).digest('base64url');
  }

  private computeIntegrityHash(payload: Record<string, unknown>): string {
    return this.sha256(this.canonicalize(payload));
  }

  private getSigningSecret(): string {
    const configured = process.env.POLICY_RECEIPT_SIGNING_SECRET ?? process.env.JWT_SECRET;
    if (configured && configured.length >= 16) {
      return configured;
    }

    if (process.env.NODE_ENV === 'production') {
      throw new PolicyDecisionReceiptError(
        'POLICY_RECEIPT_SIGNING_SECRET (or JWT_SECRET) must be configured in production',
        'POLICY_RECEIPT_SECRET_MISSING',
        500,
      );
    }

    return 'zeroid-policy-receipt-dev-secret';
  }

  private sha256(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  private safeCompare(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
  }

  private canonicalize(value: unknown): string {
    if (value === null || value === undefined) return JSON.stringify(value);
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
      return '[' + value.map((entry) => this.canonicalize(entry)).join(',') + ']';
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return '{' + keys.map((key) => `${JSON.stringify(key)}:${this.canonicalize(obj[key])}`).join(',') + '}';
  }

  private normalizePolicyExceptionIds(ids?: string[]): string[] {
    if (!ids || ids.length === 0) {
      return [];
    }

    return Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))).sort();
  }

  private async buildLineageSnapshot(receipt: PolicyDecisionReceipt): Promise<PolicyDecisionReceiptExport['lineage'] | undefined> {
    const policyModel = (prisma as any).policyDefinition;
    const exceptionModel = (prisma as any).policyException;

    const policy = receipt.policyDefinitionId && policyModel?.findFirst
      ? await policyModel.findFirst({
        where: {
          id: receipt.policyDefinitionId,
          organizationId: receipt.organizationId,
        },
      })
      : null;

    const exceptions = receipt.policyExceptionIds.length > 0 && exceptionModel?.findMany
      ? await exceptionModel.findMany({
        where: {
          organizationId: receipt.organizationId,
          id: {
            in: receipt.policyExceptionIds,
          },
        },
        orderBy: [
          { createdAt: 'asc' },
        ],
      })
      : [];

    if (!policy && (!exceptions || exceptions.length === 0)) {
      return undefined;
    }

    return {
      ...(policy ? {
        policy: {
          policyDefinitionId: policy.id,
          status: String(policy.status ?? 'APPROVED').toLowerCase(),
          policyName: policy.name,
          policyVersion: policy.version,
          ...(policy.reference ? { policyReference: policy.reference } : {}),
          ...(policy.approvedByIdentityId !== undefined ? { approvedByIdentityId: policy.approvedByIdentityId ?? null } : {}),
          ...(policy.effectiveFrom ? { effectiveFrom: policy.effectiveFrom.toISOString() } : {}),
          ...(policy.expiresAt ? { expiresAt: policy.expiresAt.toISOString() } : {}),
          ...(policy.governanceProfileId !== undefined ? { governanceProfileId: policy.governanceProfileId ?? null } : {}),
          ...(policy.governanceProfileLabel !== undefined ? { governanceProfileLabel: policy.governanceProfileLabel ?? null } : {}),
          ...(Array.isArray(policy.governanceProfileRationale) && policy.governanceProfileRationale.length > 0
            ? { governanceProfileRationale: this.normalizeGovernanceRationale(policy.governanceProfileRationale) }
            : {}),
          ...(policy.deprecatedAt ? { deprecatedAt: policy.deprecatedAt.toISOString() } : {}),
          ...(policy.deprecatedByIdentityId !== undefined ? { deprecatedByIdentityId: policy.deprecatedByIdentityId ?? null } : {}),
          ...(policy.deprecationReason !== undefined ? { deprecationReason: policy.deprecationReason ?? null } : {}),
          ...(policy.supersededByPolicyDefinitionId !== undefined ? { supersededByPolicyDefinitionId: policy.supersededByPolicyDefinitionId ?? null } : {}),
          ...(policy.revokedAt ? { revokedAt: policy.revokedAt.toISOString() } : {}),
          ...(policy.revokedByIdentityId !== undefined ? { revokedByIdentityId: policy.revokedByIdentityId ?? null } : {}),
          ...(policy.revocationReason !== undefined ? { revocationReason: policy.revocationReason ?? null } : {}),
        },
      } : {}),
      exceptions: (exceptions ?? []).map((exception: any) => ({
        exceptionId: exception.id,
        status: String(exception.status ?? 'APPROVED').toLowerCase(),
        policyName: exception.policyName,
        policyVersion: exception.policyVersion,
        policyReference: exception.policyReference,
        ...(exception.governanceProfileId !== undefined ? { governanceProfileId: exception.governanceProfileId ?? null } : {}),
        ...(exception.governanceProfileLabel !== undefined ? { governanceProfileLabel: exception.governanceProfileLabel ?? null } : {}),
        ...(Array.isArray(exception.governanceProfileRationale) && exception.governanceProfileRationale.length > 0
          ? { governanceProfileRationale: this.normalizeGovernanceRationale(exception.governanceProfileRationale) }
          : {}),
        ...(exception.subjectEntityId ? { subjectEntityId: exception.subjectEntityId } : {}),
        scope: String(exception.scope ?? 'SUBJECT').toLowerCase(),
        ...(exception.approvedByIdentityId !== undefined ? { approvedByIdentityId: exception.approvedByIdentityId ?? null } : {}),
        ...(exception.effectiveFrom ? { effectiveFrom: exception.effectiveFrom.toISOString() } : {}),
        ...(exception.expiresAt ? { expiresAt: exception.expiresAt.toISOString() } : {}),
        ...(exception.revokedAt ? { revokedAt: exception.revokedAt.toISOString() } : {}),
        ...(exception.revokedByIdentityId !== undefined ? { revokedByIdentityId: exception.revokedByIdentityId ?? null } : {}),
        ...(exception.revocationReason !== undefined ? { revocationReason: exception.revocationReason ?? null } : {}),
      })),
    };
  }

  private normalizeReceipt(receipt: PolicyDecisionReceipt): PolicyDecisionReceipt {
    const policyExceptionIds = this.normalizePolicyExceptionIds(receipt.policyExceptionIds);
    return {
      ...receipt,
      ...(receipt.policyDefinitionId ? { policyDefinitionId: receipt.policyDefinitionId } : {}),
      ...(receipt.policyReference ? { policyReference: receipt.policyReference } : {}),
      ...(receipt.policyApprovedByIdentityId ? { policyApprovedByIdentityId: receipt.policyApprovedByIdentityId } : {}),
      ...(receipt.policyEffectiveFrom ? { policyEffectiveFrom: receipt.policyEffectiveFrom } : {}),
      ...(receipt.policyExpiresAt ? { policyExpiresAt: receipt.policyExpiresAt } : {}),
      ...(receipt.policyGovernanceProfileId ? { policyGovernanceProfileId: receipt.policyGovernanceProfileId } : {}),
      ...(receipt.policyGovernanceProfileLabel ? { policyGovernanceProfileLabel: receipt.policyGovernanceProfileLabel } : {}),
      ...(receipt.policyGovernanceRationale && receipt.policyGovernanceRationale.length > 0
        ? { policyGovernanceRationale: this.normalizeGovernanceRationale(receipt.policyGovernanceRationale) }
        : {}),
      policyExceptionIds,
      policyExceptionCount: typeof receipt.policyExceptionCount === 'number'
        ? receipt.policyExceptionCount
        : policyExceptionIds.length,
    };
  }

  private formatLedgerReceipt(record: any): PolicyDecisionReceipt {
    return this.normalizeReceipt({
      receiptId: record.receiptId,
      organizationId: record.organizationId,
      actorIdentityId: record.actorIdentityId,
      receiptType: this.fromLedgerReceiptType(record.receiptType),
      policyName: record.policyName,
      policyVersion: record.policyVersion,
      policyDefinitionId: record.policyDefinitionId ?? undefined,
      policyReference: record.policyReference ?? undefined,
      policyApprovedByIdentityId: record.policyApprovedByIdentityId ?? undefined,
      policyEffectiveFrom: record.policyEffectiveFrom ? record.policyEffectiveFrom.toISOString() : undefined,
      policyExpiresAt: record.policyExpiresAt ? record.policyExpiresAt.toISOString() : undefined,
      policyGovernanceProfileId: record.policyGovernanceProfileId ?? undefined,
      policyGovernanceProfileLabel: record.policyGovernanceProfileLabel ?? undefined,
      ...(Array.isArray(record.policyGovernanceRationale) && record.policyGovernanceRationale.length > 0
        ? { policyGovernanceRationale: this.normalizeGovernanceRationale(record.policyGovernanceRationale) }
        : {}),
      subjectEntityId: record.subjectEntityId ?? undefined,
      policyExceptionIds: Array.isArray(record.policyExceptionIds) ? record.policyExceptionIds : [],
      policyExceptionCount: typeof record.policyExceptionCount === 'number'
        ? record.policyExceptionCount
        : Array.isArray(record.policyExceptionIds) ? record.policyExceptionIds.length : 0,
      jurisdictionCodes: record.jurisdictionCodes,
      decisionSummary: record.decisionSummary,
      inputDigest: record.inputDigest,
      outputDigest: record.outputDigest,
      evidenceDigest: record.evidenceDigest,
      integrityHash: record.integrityHash,
      integrityToken: record.integrityToken,
      metadata: record.metadata ?? undefined,
      createdAt: record.createdAt.toISOString(),
      expiresAt: record.expiresAt.toISOString(),
    });
  }

  private normalizeGovernanceRationale(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return [...new Set(
      value
        .map((entry) => String(entry).trim())
        .filter((entry) => entry.length > 0),
    )];
  }
}

export const policyDecisionReceiptService = new PolicyDecisionReceiptService();
