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
  subjectEntityId?: string;
  decisionSummary: string;
  createdAt: string;
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

    await redis.set(this.receiptKey(receiptId), JSON.stringify(receipt), 'EX', RECEIPT_TTL_SECONDS);
    await this.updateOrganizationIndex(input.organizationId, {
      receiptId,
      receiptType: input.receiptType,
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
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as PolicyDecisionReceipt;
  }

  async listReceipts(
    organizationId: string,
    limit = 25,
  ): Promise<PolicyDecisionReceiptListItem[]> {
    const raw = await redis.get(this.organizationIndexKey(organizationId));
    if (!raw) {
      return [];
    }

    const items = JSON.parse(raw) as PolicyDecisionReceiptListItem[];
    const boundedLimit = Math.min(RECEIPT_INDEX_LIMIT, Math.max(1, limit));
    return items.slice(0, boundedLimit);
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

  private async updateOrganizationIndex(
    organizationId: string,
    item: PolicyDecisionReceiptListItem,
  ): Promise<void> {
    const existing = await this.listReceipts(organizationId, RECEIPT_INDEX_LIMIT);
    const next = [item, ...existing].slice(0, RECEIPT_INDEX_LIMIT);
    await redis.set(this.organizationIndexKey(organizationId), JSON.stringify(next), 'EX', RECEIPT_TTL_SECONDS);
  }

  private receiptKey(receiptId: string): string {
    return `policy:receipt:${receiptId}`;
  }

  private organizationIndexKey(organizationId: string): string {
    return `policy:receipt:index:${organizationId}`;
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
}

export const policyDecisionReceiptService = new PolicyDecisionReceiptService();
