import crypto from 'crypto';
import { prisma, redis } from '../../index';

const RECEIPT_TTL_SECONDS = 90 * 24 * 60 * 60;
const RECEIPT_INDEX_LIMIT = 200;

export type PolicyReceiptType =
  | 'compliance_evaluation'
  | 'regulatory_report'
  | 'cross_border_assessment'
  | 'privacy_impact_assessment'
  | 'sanctions_screening';

export interface PolicyDecisionReceipt {
  receiptId: string;
  organizationId: string;
  actorIdentityId: string;
  receiptType: PolicyReceiptType;
  policyName: string;
  policyVersion: string;
  policyReference?: string;
  subjectEntityId?: string;
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
  policyReference?: string;
  subjectEntityId?: string;
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
      policyReference: input.policyReference ?? null,
      subjectEntityId: input.subjectEntityId ?? null,
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
      policyReference: input.policyReference,
      subjectEntityId: input.subjectEntityId,
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
          policyReference: input.policyReference ?? null,
          subjectEntityId: input.subjectEntityId ?? null,
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
      return JSON.parse(raw) as PolicyDecisionReceipt;
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
      policyReference: receipt.policyReference ?? null,
      subjectEntityId: receipt.subjectEntityId ?? null,
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

    return {
      formatVersion: 'zeroid.policy_receipt_export.v1',
      exportedAt: new Date().toISOString(),
      verified: verification.valid,
      receipt: verification.receipt,
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
        policyReference: receipt.policyReference,
        subjectEntityId: receipt.subjectEntityId,
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

  private formatLedgerReceipt(record: any): PolicyDecisionReceipt {
    return {
      receiptId: record.receiptId,
      organizationId: record.organizationId,
      actorIdentityId: record.actorIdentityId,
      receiptType: this.fromLedgerReceiptType(record.receiptType),
      policyName: record.policyName,
      policyVersion: record.policyVersion,
      policyReference: record.policyReference ?? undefined,
      subjectEntityId: record.subjectEntityId ?? undefined,
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
    };
  }
}

export const policyDecisionReceiptService = new PolicyDecisionReceiptService();
