import crypto from 'crypto';
import { prisma, redis } from '../../index';
import { credentialService } from '../credential';

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
  policyGovernancePackId?: string;
  policyGovernancePackVersion?: string;
  policyGovernancePackLabel?: string;
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
  policyGovernancePackId?: string;
  policyGovernancePackVersion?: string;
  policyGovernancePackLabel?: string;
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

interface GovernancePackSelectionSnapshot {
  packId: string;
  version?: string;
}

interface GovernanceChangeSnapshot {
  changedAt: string;
  changedByIdentityId: string;
  changeReason?: string;
  defaultPack?: GovernancePackSelectionSnapshot;
  familyPacks?: Record<string, GovernancePackSelectionSnapshot>;
}

interface OrganizationGovernanceSnapshot {
  defaultPack?: GovernancePackSelectionSnapshot;
  familyPacks?: Record<string, GovernancePackSelectionSnapshot>;
  lastUpdatedAt?: string;
  lastUpdatedByIdentityId?: string;
  activePack?: {
    id: string;
    version?: string;
    label?: string;
    policyFamily?: string;
  };
  changeHistory?: GovernanceChangeSnapshot[];
}

interface RuntimeGovernanceOverlaySnapshot {
  packId: string;
  packVersion?: string;
  packLabel?: string;
  directives: string[];
  appliedDirectives?: string[];
}

interface ReceiptTrustAnchorSnapshot {
  issuerIdentityId: string;
  issuerDid: string;
  issuerDisplayName?: string | null;
  trustRecordId?: string;
  status: string;
  accreditationScope?: string;
  assuranceLevel?: string;
  accepted: boolean;
  evaluatedCredentialTypes: string[];
  matchedJurisdictions: string[];
  expiresAt?: string;
}

interface ReceiptCredentialEvidenceReference {
  credentialId: string;
  issuerId: string;
  credentialType: string;
}

interface ReceiptCredentialEvidenceUsageSnapshot {
  credentialId: string;
  issuerId: string;
  credentialType: string;
  operationType?: string;
  rulePaths: Array<{
    jurisdiction: string;
    rulePath: string;
    status: 'satisfied' | 'supplemental';
  }>;
}

interface ReceiptObligationEvidenceUsageSnapshot {
  domain: 'cross_border' | 'reporting' | 'privacy';
  obligationType: string;
  rulePath: string;
  status: 'satisfied' | 'escalated';
  detail?: string;
  sourceJurisdiction?: string;
  targetJurisdiction?: string;
  jurisdiction?: string;
  reportType?: string;
}

interface TrustAnchorLineageTrustRecord {
  trustRecordId: string;
  status: string;
  accreditationScope?: string;
  assuranceLevel?: string;
  allowedCredentialTypes: string[];
  allowedJurisdictions: string[];
  proposedByIdentityId?: string | null;
  accreditedByIdentityId?: string | null;
  suspensionReason?: string | null;
  metadata?: Record<string, unknown> | null;
  accreditedAt?: string;
  expiresAt?: string;
  updatedAt?: string;
}

interface TrustAnchorKeyHistorySnapshot {
  keyHistoryId: string;
  keyVersion: string;
  keyAlgorithm: string;
  verificationMethod: string;
  status: string;
  validFrom: string;
  validUntil?: string | null;
  rotatedByIdentityId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

interface TrustAnchorLineageSnapshot {
  issuerIdentityId: string;
  issuerDid: string;
  issuerDisplayName?: string | null;
  accepted: boolean;
  evaluatedCredentialTypes: string[];
  matchedJurisdictions: string[];
  trustRegime: {
    status: string;
    accreditationScope?: string;
    assuranceLevel?: string;
    expiresAt?: string;
  };
  trustRecord?: TrustAnchorLineageTrustRecord;
  keyLineage?: {
    current?: TrustAnchorKeyHistorySnapshot;
    history: TrustAnchorKeyHistorySnapshot[];
  };
}

interface CredentialEvidenceLineageSnapshot {
  credentialId: string;
  credentialType: string;
  issuerId: string;
  subjectId: string;
  status: string;
  issuedAt: string;
  expiresAt?: string | null;
  verification: {
    valid: boolean;
    checks: Record<string, boolean>;
  };
  issuer: {
    identityId: string;
    did?: string;
    status?: string;
    keyVersion?: string;
    keyAlgorithm?: string;
    verificationMethod?: string | null;
  };
  subject: {
    identityId: string;
    did?: string;
    status?: string;
  };
  trustLineage?: {
    enforced: boolean;
    selectedTrustRecordId?: string;
    accreditationScope?: string;
    assuranceLevel?: string;
    evaluatedJurisdictions: string[];
    matchedJurisdictions: string[];
    trustRecord?: {
      trustRecordId: string;
      status: string;
      accreditationScope?: string;
      assuranceLevel?: string;
      allowedCredentialTypes: string[];
      allowedJurisdictions: string[];
      proposedByIdentityId?: string | null;
      accreditedByIdentityId?: string | null;
      suspensionReason?: string | null;
      metadata?: Record<string, unknown> | null;
      accreditedAt?: string;
      expiresAt?: string;
      updatedAt?: string;
    };
    keyLineage?: {
      current?: {
        keyHistoryId: string;
        keyVersion: string;
        keyAlgorithm: string;
        verificationMethod: string;
        status: string;
        validFrom: string;
        validUntil?: string | null;
        rotatedByIdentityId?: string | null;
        metadata?: Record<string, unknown> | null;
        createdAt: string;
      };
      history: Array<{
        keyHistoryId: string;
        keyVersion: string;
        keyAlgorithm: string;
        verificationMethod: string;
        status: string;
        validFrom: string;
        validUntil?: string | null;
        rotatedByIdentityId?: string | null;
        metadata?: Record<string, unknown> | null;
        createdAt: string;
      }>;
    };
  };
  usage?: {
    operationType?: string;
    rulePaths: Array<{
      jurisdiction: string;
      rulePath: string;
      status: 'satisfied' | 'supplemental';
    }>;
  };
}

interface ObligationEvidenceLineageSnapshot {
  domain: 'cross_border' | 'reporting' | 'privacy';
  obligationType: string;
  rulePath: string;
  status: 'satisfied' | 'escalated';
  detail?: string;
  sourceJurisdiction?: string;
  targetJurisdiction?: string;
  jurisdiction?: string;
  reportType?: string;
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
      governancePackId?: string | null;
      governancePackVersion?: string | null;
      governancePackLabel?: string | null;
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
    credentials: CredentialEvidenceLineageSnapshot[];
    obligations: ObligationEvidenceLineageSnapshot[];
    trustAnchors: TrustAnchorLineageSnapshot[];
  };
  operatingRegime?: {
    organizationGovernance?: OrganizationGovernanceSnapshot;
    runtimeOverlay?: RuntimeGovernanceOverlaySnapshot;
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
      policyGovernancePackId: input.policyGovernancePackId ?? null,
      policyGovernancePackVersion: input.policyGovernancePackVersion ?? null,
      policyGovernancePackLabel: input.policyGovernancePackLabel ?? null,
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
      policyGovernancePackId: input.policyGovernancePackId,
      policyGovernancePackVersion: input.policyGovernancePackVersion,
      policyGovernancePackLabel: input.policyGovernancePackLabel,
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
          policyGovernancePackId: input.policyGovernancePackId ?? null,
          policyGovernancePackVersion: input.policyGovernancePackVersion ?? null,
          policyGovernancePackLabel: input.policyGovernancePackLabel ?? null,
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
      policyGovernancePackId: receipt.policyGovernancePackId ?? null,
      policyGovernancePackVersion: receipt.policyGovernancePackVersion ?? null,
      policyGovernancePackLabel: receipt.policyGovernancePackLabel ?? null,
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
    const operatingRegime = this.buildOperatingRegimeSnapshot(verification.receipt);

    return {
      formatVersion: 'zeroid.policy_receipt_export.v1',
      exportedAt: new Date().toISOString(),
      verified: verification.valid,
      receipt: verification.receipt,
      ...(lineage ? { lineage } : {}),
      ...(operatingRegime ? { operatingRegime } : {}),
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
        policyGovernancePackId: receipt.policyGovernancePackId,
        policyGovernancePackVersion: receipt.policyGovernancePackVersion,
        policyGovernancePackLabel: receipt.policyGovernancePackLabel,
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

    const credentials = await this.buildCredentialEvidenceLineage(receipt);
    const obligations = this.buildObligationEvidenceLineage(receipt);
    const trustAnchors = await this.buildTrustAnchorLineage(receipt);

    if (
      !policy
      && (!exceptions || exceptions.length === 0)
      && credentials.length === 0
      && obligations.length === 0
      && trustAnchors.length === 0
    ) {
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
          ...(policy.governancePackId !== undefined ? { governancePackId: policy.governancePackId ?? null } : {}),
          ...(policy.governancePackVersion !== undefined ? { governancePackVersion: policy.governancePackVersion ?? null } : {}),
          ...(policy.governancePackLabel !== undefined ? { governancePackLabel: policy.governancePackLabel ?? null } : {}),
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
      credentials,
      obligations,
      trustAnchors,
    };
  }

  private async buildCredentialEvidenceLineage(
    receipt: PolicyDecisionReceipt,
  ): Promise<CredentialEvidenceLineageSnapshot[]> {
    const metadata = this.asRecord(receipt.metadata);
    const credentialReferences = this.normalizeCredentialEvidenceReferences(metadata.credentialEvidenceRefs);
    const credentialUsage = this.normalizeCredentialEvidenceUsage(metadata.credentialEvidenceUsage);
    if (credentialReferences.length === 0) {
      return [];
    }

    const exports = await Promise.all(credentialReferences.map(async (reference) => {
      try {
        const exported = await credentialService.exportCredentialEvidence(reference.credentialId);
        return this.sanitizeCredentialEvidenceLineage(
          exported,
          credentialUsage.find((usage) => usage.credentialId === reference.credentialId),
        );
      } catch {
        return null;
      }
    }));

    return exports.filter((entry): entry is CredentialEvidenceLineageSnapshot => entry !== null);
  }

  private buildObligationEvidenceLineage(
    receipt: PolicyDecisionReceipt,
  ): ObligationEvidenceLineageSnapshot[] {
    const metadata = this.asRecord(receipt.metadata);
    return this.normalizeObligationEvidenceUsage(metadata.obligationEvidenceUsage);
  }

  private async buildTrustAnchorLineage(
    receipt: PolicyDecisionReceipt,
  ): Promise<TrustAnchorLineageSnapshot[]> {
    const metadata = this.asRecord(receipt.metadata);
    const trustContext = this.asRecord(metadata.trustContext);
    const anchors = this.normalizeTrustAnchors(trustContext.anchors);
    if (anchors.length === 0) {
      return [];
    }

    const trustModel = (prisma as any).issuerTrustRecord;
    const keyHistoryModel = (prisma as any).issuerKeyHistory;
    const issuerIdentityIds = [...new Set(anchors.map((anchor) => anchor.issuerIdentityId))];
    const trustRecordIds = [
      ...new Set(
        anchors
          .map((anchor) => anchor.trustRecordId)
          .filter((trustRecordId): trustRecordId is string => typeof trustRecordId === 'string' && trustRecordId.length > 0),
      ),
    ];

    const trustRecords = trustModel?.findMany
      ? await trustModel.findMany({
        where: {
          organizationId: receipt.organizationId,
          issuerIdentityId: {
            in: issuerIdentityIds,
          },
        },
        include: {
          issuer: {
            select: {
              displayName: true,
            },
          },
        },
        orderBy: {
          updatedAt: 'desc',
        },
      })
      : [];

    const keyHistory = keyHistoryModel?.findMany
      ? await keyHistoryModel.findMany({
        where: {
          issuerIdentityId: {
            in: issuerIdentityIds,
          },
        },
        orderBy: [
          { validFrom: 'desc' },
          { createdAt: 'desc' },
        ],
      })
      : [];

    return anchors.map((anchor) => {
      const trustRecord = trustRecordIds.length > 0 && anchor.trustRecordId
        ? trustRecords.find((record: any) => record.id === anchor.trustRecordId)
        : trustRecords.find((record: any) => record.issuerIdentityId === anchor.issuerIdentityId);
      const issuerKeyHistory = keyHistory.filter((record: any) => record.issuerIdentityId === anchor.issuerIdentityId);
      const currentKey = issuerKeyHistory.find((record: any) => String(record.status ?? '').toUpperCase() === 'ACTIVE')
        ?? issuerKeyHistory[0];

      return {
        issuerIdentityId: anchor.issuerIdentityId,
        issuerDid: anchor.issuerDid,
        ...(anchor.issuerDisplayName !== undefined ? { issuerDisplayName: anchor.issuerDisplayName } : {}),
        accepted: anchor.accepted,
        evaluatedCredentialTypes: anchor.evaluatedCredentialTypes,
        matchedJurisdictions: anchor.matchedJurisdictions,
        trustRegime: {
          status: trustRecord ? String(trustRecord.status ?? anchor.status).toLowerCase() : anchor.status,
          ...(trustRecord?.accreditationScope !== undefined
            ? { accreditationScope: String(trustRecord.accreditationScope).toLowerCase() }
            : anchor.accreditationScope
              ? { accreditationScope: anchor.accreditationScope }
              : {}),
          ...(trustRecord?.assuranceLevel !== undefined
            ? { assuranceLevel: String(trustRecord.assuranceLevel).toLowerCase() }
            : anchor.assuranceLevel
              ? { assuranceLevel: anchor.assuranceLevel }
              : {}),
          ...(trustRecord?.expiresAt
            ? { expiresAt: new Date(trustRecord.expiresAt).toISOString() }
            : anchor.expiresAt
              ? { expiresAt: anchor.expiresAt }
              : {}),
        },
        ...(trustRecord ? {
          trustRecord: this.serializeTrustAnchorTrustRecord(trustRecord),
        } : {}),
        ...(issuerKeyHistory.length > 0 ? {
          keyLineage: {
            ...(currentKey ? { current: this.serializeTrustAnchorKeyHistory(currentKey) } : {}),
            history: issuerKeyHistory.map((record: any) => this.serializeTrustAnchorKeyHistory(record)),
          },
        } : {}),
      };
    });
  }

  private buildOperatingRegimeSnapshot(
    receipt: PolicyDecisionReceipt,
  ): PolicyDecisionReceiptExport['operatingRegime'] | undefined {
    const metadata = this.asRecord(receipt.metadata);
    const governanceContext = this.asRecord(metadata.organizationGovernanceContext);
    const policyExecutionTrace = this.asRecord(metadata.policyExecutionTrace);
    const governanceOverlay = this.asRecord(policyExecutionTrace.governanceOverlay);
    if (Object.keys(governanceContext).length === 0 && Object.keys(governanceOverlay).length === 0) {
      return undefined;
    }

    const snapshot: OrganizationGovernanceSnapshot = {
      ...(this.normalizePackSelection(governanceContext.defaultPack)
        ? { defaultPack: this.normalizePackSelection(governanceContext.defaultPack) }
        : {}),
      ...(this.normalizeFamilyPackSelections(governanceContext.familyPacks)
        ? { familyPacks: this.normalizeFamilyPackSelections(governanceContext.familyPacks) }
        : {}),
      ...(typeof governanceContext.lastUpdatedAt === 'string' && governanceContext.lastUpdatedAt.length > 0
        ? { lastUpdatedAt: governanceContext.lastUpdatedAt }
        : {}),
      ...(typeof governanceContext.lastUpdatedByIdentityId === 'string' && governanceContext.lastUpdatedByIdentityId.length > 0
        ? { lastUpdatedByIdentityId: governanceContext.lastUpdatedByIdentityId }
        : {}),
      ...(this.normalizeActivePack(governanceContext.activePack)
        ? { activePack: this.normalizeActivePack(governanceContext.activePack) }
        : {}),
      ...(this.normalizeGovernanceChangeHistory(governanceContext.changeHistory).length > 0
        ? { changeHistory: this.normalizeGovernanceChangeHistory(governanceContext.changeHistory) }
        : {}),
    };
    const runtimeOverlay = this.normalizeRuntimeGovernanceOverlay(governanceOverlay);

    if (Object.keys(snapshot).length === 0 && !runtimeOverlay) {
      return undefined;
    }

    return {
      ...(Object.keys(snapshot).length > 0 ? { organizationGovernance: snapshot } : {}),
      ...(runtimeOverlay ? { runtimeOverlay } : {}),
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
      ...(receipt.policyGovernancePackId ? { policyGovernancePackId: receipt.policyGovernancePackId } : {}),
      ...(receipt.policyGovernancePackVersion ? { policyGovernancePackVersion: receipt.policyGovernancePackVersion } : {}),
      ...(receipt.policyGovernancePackLabel ? { policyGovernancePackLabel: receipt.policyGovernancePackLabel } : {}),
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
      policyGovernancePackId: record.policyGovernancePackId ?? undefined,
      policyGovernancePackVersion: record.policyGovernancePackVersion ?? undefined,
      policyGovernancePackLabel: record.policyGovernancePackLabel ?? undefined,
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

  private normalizePackSelection(value: unknown): GovernancePackSelectionSnapshot | undefined {
    const record = this.asRecord(value);
    if (typeof record.packId !== 'string' || record.packId.length === 0) {
      return undefined;
    }

    return {
      packId: record.packId,
      ...(typeof record.version === 'string' && record.version.length > 0
        ? { version: record.version }
        : {}),
    };
  }

  private normalizeFamilyPackSelections(
    value: unknown,
  ): Record<string, GovernancePackSelectionSnapshot> | undefined {
    const record = this.asRecord(value);
    const normalized = Object.entries(record).reduce<Record<string, GovernancePackSelectionSnapshot>>((acc, [key, selection]) => {
      const parsed = this.normalizePackSelection(selection);
      if (parsed) {
        acc[key] = parsed;
      }
      return acc;
    }, {});

    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  private normalizeActivePack(
    value: unknown,
  ): OrganizationGovernanceSnapshot['activePack'] | undefined {
    const record = this.asRecord(value);
    if (typeof record.id !== 'string' || record.id.length === 0) {
      return undefined;
    }

    return {
      id: record.id,
      ...(typeof record.version === 'string' && record.version.length > 0
        ? { version: record.version }
        : {}),
      ...(typeof record.label === 'string' && record.label.length > 0
        ? { label: record.label }
        : {}),
      ...(typeof record.policyFamily === 'string' && record.policyFamily.length > 0
        ? { policyFamily: record.policyFamily }
        : {}),
    };
  }

  private normalizeGovernanceChangeHistory(value: unknown): GovernanceChangeSnapshot[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => this.asRecord(entry))
      .map((entry) => ({
        changedAt: typeof entry.changedAt === 'string' ? entry.changedAt : '',
        changedByIdentityId: typeof entry.changedByIdentityId === 'string' ? entry.changedByIdentityId : '',
        ...(typeof entry.changeReason === 'string' && entry.changeReason.length > 0
          ? { changeReason: entry.changeReason }
          : {}),
        ...(this.normalizePackSelection(entry.defaultPack)
          ? { defaultPack: this.normalizePackSelection(entry.defaultPack) }
          : {}),
        ...(this.normalizeFamilyPackSelections(entry.familyPacks)
          ? { familyPacks: this.normalizeFamilyPackSelections(entry.familyPacks) }
          : {}),
      }))
      .filter((entry) => entry.changedAt.length > 0 && entry.changedByIdentityId.length > 0)
      .slice(-5);
  }

  private normalizeRuntimeGovernanceOverlay(value: unknown): RuntimeGovernanceOverlaySnapshot | undefined {
    const record = this.asRecord(value);
    if (typeof record.packId !== 'string' || record.packId.length === 0) {
      return undefined;
    }

    const directives = this.normalizeStringArray(record.directives);
    if (directives.length === 0) {
      return undefined;
    }

    const appliedDirectives = this.normalizeStringArray(record.appliedDirectives);
    return {
      packId: record.packId,
      ...(typeof record.packVersion === 'string' && record.packVersion.length > 0
        ? { packVersion: record.packVersion }
        : {}),
      ...(typeof record.packLabel === 'string' && record.packLabel.length > 0
        ? { packLabel: record.packLabel }
        : {}),
      directives,
      ...(appliedDirectives.length > 0 ? { appliedDirectives } : {}),
    };
  }

  private normalizeTrustAnchors(value: unknown): ReceiptTrustAnchorSnapshot[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => this.asRecord(entry))
      .map((entry) => ({
        issuerIdentityId: typeof entry.issuerIdentityId === 'string' ? entry.issuerIdentityId : '',
        issuerDid: typeof entry.issuerDid === 'string' ? entry.issuerDid : '',
        ...(entry.issuerDisplayName === null || typeof entry.issuerDisplayName === 'string'
          ? { issuerDisplayName: entry.issuerDisplayName as string | null }
          : {}),
        ...(typeof entry.trustRecordId === 'string' && entry.trustRecordId.length > 0
          ? { trustRecordId: entry.trustRecordId }
          : {}),
        status: typeof entry.status === 'string' ? entry.status : 'untracked',
        ...(typeof entry.accreditationScope === 'string' && entry.accreditationScope.length > 0
          ? { accreditationScope: entry.accreditationScope }
          : {}),
        ...(typeof entry.assuranceLevel === 'string' && entry.assuranceLevel.length > 0
          ? { assuranceLevel: entry.assuranceLevel }
          : {}),
        accepted: Boolean(entry.accepted),
        evaluatedCredentialTypes: this.normalizeStringArray(entry.evaluatedCredentialTypes),
        matchedJurisdictions: this.normalizeStringArray(entry.matchedJurisdictions),
        ...(typeof entry.expiresAt === 'string' && entry.expiresAt.length > 0
          ? { expiresAt: entry.expiresAt }
          : {}),
      }))
      .filter((entry) => entry.issuerIdentityId.length > 0);
  }

  private normalizeCredentialEvidenceReferences(value: unknown): ReceiptCredentialEvidenceReference[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => this.asRecord(entry))
      .map((entry) => ({
        credentialId: typeof entry.credentialId === 'string' ? entry.credentialId : '',
        issuerId: typeof entry.issuerId === 'string' ? entry.issuerId : '',
        credentialType: typeof entry.credentialType === 'string' ? entry.credentialType : '',
      }))
      .filter((entry) => entry.credentialId.length > 0)
      .reduce<ReceiptCredentialEvidenceReference[]>((acc, entry) => {
        if (!acc.some((existing) => existing.credentialId === entry.credentialId)) {
          acc.push(entry);
        }
        return acc;
      }, []);
  }

  private normalizeCredentialEvidenceUsage(value: unknown): ReceiptCredentialEvidenceUsageSnapshot[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => this.asRecord(entry))
      .map((entry) => ({
        credentialId: typeof entry.credentialId === 'string' ? entry.credentialId : '',
        issuerId: typeof entry.issuerId === 'string' ? entry.issuerId : '',
        credentialType: typeof entry.credentialType === 'string' ? entry.credentialType : '',
        ...(typeof entry.operationType === 'string' && entry.operationType.length > 0
          ? { operationType: entry.operationType }
          : {}),
        rulePaths: Array.isArray(entry.rulePaths)
          ? entry.rulePaths
            .map((rulePath) => this.asRecord(rulePath))
            .map((rulePath) => ({
              jurisdiction: typeof rulePath.jurisdiction === 'string' ? rulePath.jurisdiction : '',
              rulePath: typeof rulePath.rulePath === 'string' ? rulePath.rulePath : '',
              status: rulePath.status === 'satisfied' ? 'satisfied' as const : 'supplemental' as const,
            }))
            .filter((rulePath) => rulePath.jurisdiction.length > 0 && rulePath.rulePath.length > 0)
          : [],
      }))
      .filter((entry) => entry.credentialId.length > 0);
  }

  private normalizeObligationEvidenceUsage(value: unknown): ObligationEvidenceLineageSnapshot[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => this.asRecord(entry))
      .map((entry) => ({
        domain: entry.domain === 'cross_border'
          ? 'cross_border' as const
          : entry.domain === 'privacy'
            ? 'privacy' as const
            : 'reporting' as const,
        obligationType: typeof entry.obligationType === 'string' ? entry.obligationType : '',
        rulePath: typeof entry.rulePath === 'string' ? entry.rulePath : '',
        status: entry.status === 'escalated' ? 'escalated' as const : 'satisfied' as const,
        ...(typeof entry.detail === 'string' && entry.detail.length > 0
          ? { detail: entry.detail }
          : {}),
        ...(typeof entry.sourceJurisdiction === 'string' && entry.sourceJurisdiction.length > 0
          ? { sourceJurisdiction: entry.sourceJurisdiction }
          : {}),
        ...(typeof entry.targetJurisdiction === 'string' && entry.targetJurisdiction.length > 0
          ? { targetJurisdiction: entry.targetJurisdiction }
          : {}),
        ...(typeof entry.jurisdiction === 'string' && entry.jurisdiction.length > 0
          ? { jurisdiction: entry.jurisdiction }
          : {}),
        ...(typeof entry.reportType === 'string' && entry.reportType.length > 0
          ? { reportType: entry.reportType }
          : {}),
      }))
      .filter((entry) => entry.obligationType.length > 0 && entry.rulePath.length > 0)
      .reduce<ObligationEvidenceLineageSnapshot[]>((acc, entry) => {
        if (!acc.some((existing) =>
          existing.domain === entry.domain
          && existing.obligationType === entry.obligationType
          && existing.rulePath === entry.rulePath
          && existing.status === entry.status
          && existing.detail === entry.detail
          && existing.sourceJurisdiction === entry.sourceJurisdiction
          && existing.targetJurisdiction === entry.targetJurisdiction
          && existing.jurisdiction === entry.jurisdiction
          && existing.reportType === entry.reportType
        )) {
          acc.push(entry);
        }
        return acc;
      }, []);
  }

  private sanitizeCredentialEvidenceLineage(
    exported: Awaited<ReturnType<typeof credentialService.exportCredentialEvidence>>,
    usage?: ReceiptCredentialEvidenceUsageSnapshot,
  ): CredentialEvidenceLineageSnapshot {
    return {
      credentialId: exported.credential.id,
      credentialType: exported.credential.credentialType,
      issuerId: exported.credential.issuerId,
      subjectId: exported.credential.subjectId,
      status: exported.credential.status,
      issuedAt: exported.credential.issuedAt instanceof Date
        ? exported.credential.issuedAt.toISOString()
        : String(exported.credential.issuedAt),
      ...(exported.credential.expiresAt
        ? {
          expiresAt: exported.credential.expiresAt instanceof Date
            ? exported.credential.expiresAt.toISOString()
            : String(exported.credential.expiresAt),
        }
        : {}),
      verification: exported.verification,
      issuer: exported.issuer,
      subject: exported.subject,
      ...(exported.trustLineage ? { trustLineage: exported.trustLineage } : {}),
      ...(usage ? {
        usage: {
          ...(usage.operationType ? { operationType: usage.operationType } : {}),
          rulePaths: usage.rulePaths,
        },
      } : {}),
    };
  }

  private serializeTrustAnchorTrustRecord(record: any): TrustAnchorLineageTrustRecord {
    return {
      trustRecordId: String(record.id),
      status: String(record.status ?? 'UNKNOWN').toLowerCase(),
      ...(record.accreditationScope !== undefined
        ? { accreditationScope: String(record.accreditationScope).toLowerCase() }
        : {}),
      ...(record.assuranceLevel !== undefined
        ? { assuranceLevel: String(record.assuranceLevel).toLowerCase() }
        : {}),
      allowedCredentialTypes: this.normalizeStringArray(record.allowedCredentialTypes),
      allowedJurisdictions: this.normalizeStringArray(record.allowedJurisdictions),
      ...(record.proposedByIdentityId !== undefined ? { proposedByIdentityId: record.proposedByIdentityId ?? null } : {}),
      ...(record.accreditedByIdentityId !== undefined ? { accreditedByIdentityId: record.accreditedByIdentityId ?? null } : {}),
      ...(record.suspensionReason !== undefined ? { suspensionReason: record.suspensionReason ?? null } : {}),
      ...(record.metadata !== undefined && record.metadata !== null ? { metadata: this.asRecord(record.metadata) } : {}),
      ...(record.accreditedAt ? { accreditedAt: new Date(record.accreditedAt).toISOString() } : {}),
      ...(record.expiresAt ? { expiresAt: new Date(record.expiresAt).toISOString() } : {}),
      ...(record.updatedAt ? { updatedAt: new Date(record.updatedAt).toISOString() } : {}),
    };
  }

  private serializeTrustAnchorKeyHistory(record: any): TrustAnchorKeyHistorySnapshot {
    return {
      keyHistoryId: String(record.id),
      keyVersion: String(record.keyVersion),
      keyAlgorithm: String(record.keyAlgorithm),
      verificationMethod: String(record.verificationMethod),
      status: String(record.status ?? 'UNKNOWN').toLowerCase(),
      validFrom: new Date(record.validFrom).toISOString(),
      ...(record.validUntil ? { validUntil: new Date(record.validUntil).toISOString() } : {}),
      ...(record.rotatedByIdentityId !== undefined ? { rotatedByIdentityId: record.rotatedByIdentityId ?? null } : {}),
      ...(record.metadata !== undefined && record.metadata !== null ? { metadata: this.asRecord(record.metadata) } : {}),
      createdAt: new Date(record.createdAt).toISOString(),
    };
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }
}

export const policyDecisionReceiptService = new PolicyDecisionReceiptService();
