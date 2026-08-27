import crypto from 'crypto';
import { prisma, redis } from '../../runtime';
import { credentialService } from '../credential';
import { isProductionRuntime } from '../production-safety';

const RECEIPT_TTL_SECONDS = 90 * 24 * 60 * 60;
const RECEIPT_INDEX_LIMIT = 200;
const MIN_PRODUCTION_RECEIPT_SIGNING_SECRET_LENGTH = 48;

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

interface ReportLifecycleLineageSnapshot {
  action: 'generated' | 'submitted' | 'amended' | 'exported';
  reportId: string;
  reportType: string;
  version: number;
  status: string;
  filingJurisdiction: string;
  authority?: string;
  filingReference?: string | null;
  deadlineField?: 'filingDeadline' | 'responseDeadline';
  deadline?: string;
  submittedAt?: string | null;
  amendmentCount?: number;
  amendmentReason?: string;
  amendedAt?: string;
  exportFormat?: string;
  exportFilename?: string;
  exportRequestedAt?: string;
  amendmentHistory?: Array<{
    version: number;
    amendedAt: string;
    reason: string;
  }>;
  deliveryChannel?: string;
  deliveryDestination?: string;
  deliveryAcknowledgementId?: string;
  deliveryAcknowledgedAt?: string;
}

interface ReportAuthorityProfileLineageSnapshot {
  authority: string;
  authorityClass:
    | 'financial_intelligence_unit'
    | 'market_regulator'
    | 'data_protection_authority'
    | 'audit_supervisor'
    | 'general_regulator';
  packageProfile:
    | 'aml_filing'
    | 'privacy_rights'
    | 'audit_package'
    | 'general_reporting';
  jurisdiction: string;
  reportType: string;
  preferredDeliveryChannels: Array<'portal_upload' | 'api' | 'sftp' | 'email'>;
  acknowledgementExpected: boolean;
  supportsAmendments: boolean;
  supportsExports: boolean;
}

interface ReportFilingDeadlineLineageSnapshot {
  field: 'filingDeadline' | 'responseDeadline';
  value: string;
  status: 'pending' | 'met' | 'overdue';
  evaluatedAt: string;
  remainingHours?: number;
  submittedOnTime?: boolean;
}

interface ReportEvidenceEventLineageSnapshot {
  eventId?: string;
  action: 'generated' | 'submitted' | 'amended' | 'exported' | 'acknowledged';
  recordedAt: string;
  receiptId?: string;
  actorIdentityId?: string;
  policyName: string;
  policyVersion?: string;
  decisionSummary?: string;
  authority?: string;
  filingReference?: string | null;
  version: number;
  amendmentReason?: string;
  exportFormat?: string;
  exportFilename?: string;
  deliveryChannel?: string;
  deliveryDestination?: string;
  deliveryAcknowledgementId?: string;
  deliveryAcknowledgedAt?: string;
}

interface ReportFilingPackageLineageSnapshot {
  packageVersion: 'zeroid.regulatory_filing_package.v1';
  reportId: string;
  reportType: string;
  version: number;
  status: string;
  filingJurisdiction: string;
  authorityProfile?: ReportAuthorityProfileLineageSnapshot;
  authorityManifest?: {
    manifestVersion: 'zeroid.report_authority_manifest.v1';
    reportId: string;
    reportType: string;
    filingJurisdiction: string;
    authority?: string;
    filingReference?: string | null;
    currentVersion: number;
    submittedAt?: string | null;
    supportedExportFormats: string[];
    preferredDeliveryChannels: Array<
      'portal_upload' | 'api' | 'sftp' | 'email'
    >;
    acknowledgementExpected: boolean;
    latestAmendment?: {
      version: number;
      amendedAt: string;
      reason: string;
    };
    latestExport?: {
      format: string;
      filename: string;
      exportedAt: string;
      deliveryChannel?: string;
      deliveryDestination?: string;
      deliveryAcknowledgementId?: string;
      deliveryAcknowledgedAt?: string;
    };
    acknowledgements: Array<{
      acknowledgementId: string;
      stage: 'submitted' | 'amended' | 'exported';
      acknowledgedAt: string;
      channel?: string;
      destination?: string;
      authority?: string;
    }>;
    handoffTrail: Array<{
      eventId: string;
      stage: 'submitted' | 'amended' | 'exported' | 'acknowledged';
      recordedAt: string;
      acknowledgementStage?: 'submitted' | 'amended' | 'exported';
      actorIdentityId?: string;
      policyName?: string;
      policyVersion?: string;
      authority?: string;
      filingReference?: string | null;
      version: number;
      amendmentReason?: string;
      exportFormat?: string;
      exportFilename?: string;
      deliveryChannel?: string;
      deliveryDestination?: string;
      acknowledgementId?: string;
      acknowledgedAt?: string;
    }>;
    lastUpdatedAt: string;
  };
  deadline?: ReportFilingDeadlineLineageSnapshot;
  lifecycle: {
    generatedAt: string;
    submittedAt?: string | null;
    filingReference?: string | null;
    amendmentCount: number;
    latestAmendment?: {
      version: number;
      amendedAt: string;
      reason: string;
    };
    lastExportedAt?: string;
    lastExportFormat?: string;
    lastExportFilename?: string;
    lastDeliveryChannel?: string;
    lastDeliveryDestination?: string;
    lastDeliveryAcknowledgementId?: string;
    lastDeliveryAcknowledgedAt?: string;
  };
  evidenceTrail: ReportEvidenceEventLineageSnapshot[];
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
    reportLifecycle?: ReportLifecycleLineageSnapshot;
    reportFilingPackage?: ReportFilingPackageLineageSnapshot;
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
  async createReceipt(
    input: CreatePolicyDecisionReceiptInput,
  ): Promise<PolicyDecisionReceipt> {
    const createdAt = new Date();
    const expiresAt = new Date(
      createdAt.getTime() + RECEIPT_TTL_SECONDS * 1000,
    );
    const receiptId = `pdr_${crypto.randomUUID()}`;
    const policyExceptionIds = this.normalizePolicyExceptionIds(
      input.policyExceptionIds,
    );

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
      policyGovernanceRationale: this.normalizeGovernanceRationale(
        input.policyGovernanceRationale,
      ),
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
      ...(input.policyGovernanceRationale &&
      input.policyGovernanceRationale.length > 0
        ? {
            policyGovernanceRationale: this.normalizeGovernanceRationale(
              input.policyGovernanceRationale,
            ),
          }
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
    await redis.set(
      this.receiptKey(receiptId),
      JSON.stringify(receipt),
      'EX',
      RECEIPT_TTL_SECONDS,
    );
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
          policyGovernancePackVersion:
            input.policyGovernancePackVersion ?? null,
          policyGovernancePackLabel: input.policyGovernancePackLabel ?? null,
          policyGovernanceProfileId: input.policyGovernanceProfileId ?? null,
          policyGovernanceProfileLabel:
            input.policyGovernanceProfileLabel ?? null,
          policyGovernanceRationale: this.normalizeGovernanceRationale(
            input.policyGovernanceRationale,
          ),
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
    await redis.set(
      this.receiptKey(receiptId),
      JSON.stringify(receipt),
      'EX',
      RECEIPT_TTL_SECONDS,
    );
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

  async verifyReceipt(
    receiptId: string,
  ): Promise<{ valid: boolean; receipt: PolicyDecisionReceipt | null }> {
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
      policyGovernanceProfileLabel:
        receipt.policyGovernanceProfileLabel ?? null,
      policyGovernanceRationale: this.normalizeGovernanceRationale(
        receipt.policyGovernanceRationale,
      ),
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
      valid:
        this.safeCompare(expectedHash, receipt.integrityHash) &&
        this.safeCompare(expectedToken, receipt.integrityToken),
      receipt,
    };
  }

  async exportReceipt(
    receiptId: string,
  ): Promise<PolicyDecisionReceiptExport | null> {
    const verification = await this.verifyReceipt(receiptId);
    if (!verification.receipt) {
      return null;
    }

    const lineage = await this.buildLineageSnapshot(verification.receipt);
    const operatingRegime = this.buildOperatingRegimeSnapshot(
      verification.receipt,
    );

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
    await redis.set(
      this.organizationIndexKey(organizationId),
      JSON.stringify(next),
      'EX',
      RECEIPT_TTL_SECONDS,
    );
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

  private async persistLedgerReceipt(
    receipt: PolicyDecisionReceipt,
  ): Promise<void> {
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
        policyEffectiveFrom: receipt.policyEffectiveFrom
          ? new Date(receipt.policyEffectiveFrom)
          : null,
        policyExpiresAt: receipt.policyExpiresAt
          ? new Date(receipt.policyExpiresAt)
          : null,
        policyGovernancePackId: receipt.policyGovernancePackId,
        policyGovernancePackVersion: receipt.policyGovernancePackVersion,
        policyGovernancePackLabel: receipt.policyGovernancePackLabel,
        policyGovernanceProfileId: receipt.policyGovernanceProfileId,
        policyGovernanceProfileLabel: receipt.policyGovernanceProfileLabel,
        policyGovernanceRationale: this.normalizeGovernanceRationale(
          receipt.policyGovernanceRationale,
        ),
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
    return crypto
      .createHmac('sha256', secret)
      .update(integrityHash)
      .digest('base64url');
  }

  private computeIntegrityHash(payload: Record<string, unknown>): string {
    return this.sha256(this.canonicalize(payload));
  }

  private getSigningSecret(): string {
    const configured = process.env.POLICY_RECEIPT_SIGNING_SECRET?.trim();
    if (isProductionRuntime()) {
      if (
        configured &&
        configured.length >= MIN_PRODUCTION_RECEIPT_SIGNING_SECRET_LENGTH
      ) {
        return configured;
      }

      throw new PolicyDecisionReceiptError(
        `POLICY_RECEIPT_SIGNING_SECRET must be configured in production and contain at least ${MIN_PRODUCTION_RECEIPT_SIGNING_SECRET_LENGTH} characters`,
        'POLICY_RECEIPT_SECRET_MISSING',
        500,
      );
    }

    if (configured && configured.length >= 16) {
      return configured;
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
      return (
        '[' + value.map((entry) => this.canonicalize(entry)).join(',') + ']'
      );
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      '{' +
      keys
        .map((key) => `${JSON.stringify(key)}:${this.canonicalize(obj[key])}`)
        .join(',') +
      '}'
    );
  }

  private normalizePolicyExceptionIds(ids?: string[]): string[] {
    if (!ids || ids.length === 0) {
      return [];
    }

    return Array.from(
      new Set(ids.filter((id) => typeof id === 'string' && id.length > 0)),
    ).sort();
  }

  private async buildLineageSnapshot(
    receipt: PolicyDecisionReceipt,
  ): Promise<PolicyDecisionReceiptExport['lineage'] | undefined> {
    const policyModel = (prisma as any).policyDefinition;
    const exceptionModel = (prisma as any).policyException;

    const policy =
      receipt.policyDefinitionId && policyModel?.findFirst
        ? await policyModel.findFirst({
            where: {
              id: receipt.policyDefinitionId,
              organizationId: receipt.organizationId,
            },
          })
        : null;

    const exceptions =
      receipt.policyExceptionIds.length > 0 && exceptionModel?.findMany
        ? await exceptionModel.findMany({
            where: {
              organizationId: receipt.organizationId,
              id: {
                in: receipt.policyExceptionIds,
              },
            },
            orderBy: [{ createdAt: 'asc' }],
          })
        : [];

    const credentials = await this.buildCredentialEvidenceLineage(receipt);
    const obligations = this.buildObligationEvidenceLineage(receipt);
    const reportLifecycle = this.buildReportLifecycleLineage(receipt);
    const reportFilingPackage = this.buildReportFilingPackageLineage(receipt);
    const trustAnchors = await this.buildTrustAnchorLineage(receipt);

    if (
      !policy &&
      (!exceptions || exceptions.length === 0) &&
      credentials.length === 0 &&
      obligations.length === 0 &&
      !reportLifecycle &&
      !reportFilingPackage &&
      trustAnchors.length === 0
    ) {
      return undefined;
    }

    return {
      ...(policy
        ? {
            policy: {
              policyDefinitionId: policy.id,
              status: String(policy.status ?? 'APPROVED').toLowerCase(),
              policyName: policy.name,
              policyVersion: policy.version,
              ...(policy.reference
                ? { policyReference: policy.reference }
                : {}),
              ...(policy.approvedByIdentityId !== undefined
                ? { approvedByIdentityId: policy.approvedByIdentityId ?? null }
                : {}),
              ...(policy.effectiveFrom
                ? { effectiveFrom: policy.effectiveFrom.toISOString() }
                : {}),
              ...(policy.expiresAt
                ? { expiresAt: policy.expiresAt.toISOString() }
                : {}),
              ...(policy.governancePackId !== undefined
                ? { governancePackId: policy.governancePackId ?? null }
                : {}),
              ...(policy.governancePackVersion !== undefined
                ? {
                    governancePackVersion: policy.governancePackVersion ?? null,
                  }
                : {}),
              ...(policy.governancePackLabel !== undefined
                ? { governancePackLabel: policy.governancePackLabel ?? null }
                : {}),
              ...(policy.governanceProfileId !== undefined
                ? { governanceProfileId: policy.governanceProfileId ?? null }
                : {}),
              ...(policy.governanceProfileLabel !== undefined
                ? {
                    governanceProfileLabel:
                      policy.governanceProfileLabel ?? null,
                  }
                : {}),
              ...(Array.isArray(policy.governanceProfileRationale) &&
              policy.governanceProfileRationale.length > 0
                ? {
                    governanceProfileRationale:
                      this.normalizeGovernanceRationale(
                        policy.governanceProfileRationale,
                      ),
                  }
                : {}),
              ...(policy.deprecatedAt
                ? { deprecatedAt: policy.deprecatedAt.toISOString() }
                : {}),
              ...(policy.deprecatedByIdentityId !== undefined
                ? {
                    deprecatedByIdentityId:
                      policy.deprecatedByIdentityId ?? null,
                  }
                : {}),
              ...(policy.deprecationReason !== undefined
                ? { deprecationReason: policy.deprecationReason ?? null }
                : {}),
              ...(policy.supersededByPolicyDefinitionId !== undefined
                ? {
                    supersededByPolicyDefinitionId:
                      policy.supersededByPolicyDefinitionId ?? null,
                  }
                : {}),
              ...(policy.revokedAt
                ? { revokedAt: policy.revokedAt.toISOString() }
                : {}),
              ...(policy.revokedByIdentityId !== undefined
                ? { revokedByIdentityId: policy.revokedByIdentityId ?? null }
                : {}),
              ...(policy.revocationReason !== undefined
                ? { revocationReason: policy.revocationReason ?? null }
                : {}),
            },
          }
        : {}),
      exceptions: (exceptions ?? []).map((exception: any) => ({
        exceptionId: exception.id,
        status: String(exception.status ?? 'APPROVED').toLowerCase(),
        policyName: exception.policyName,
        policyVersion: exception.policyVersion,
        policyReference: exception.policyReference,
        ...(exception.governanceProfileId !== undefined
          ? { governanceProfileId: exception.governanceProfileId ?? null }
          : {}),
        ...(exception.governanceProfileLabel !== undefined
          ? { governanceProfileLabel: exception.governanceProfileLabel ?? null }
          : {}),
        ...(Array.isArray(exception.governanceProfileRationale) &&
        exception.governanceProfileRationale.length > 0
          ? {
              governanceProfileRationale: this.normalizeGovernanceRationale(
                exception.governanceProfileRationale,
              ),
            }
          : {}),
        ...(exception.subjectEntityId
          ? { subjectEntityId: exception.subjectEntityId }
          : {}),
        scope: String(exception.scope ?? 'SUBJECT').toLowerCase(),
        ...(exception.approvedByIdentityId !== undefined
          ? { approvedByIdentityId: exception.approvedByIdentityId ?? null }
          : {}),
        ...(exception.effectiveFrom
          ? { effectiveFrom: exception.effectiveFrom.toISOString() }
          : {}),
        ...(exception.expiresAt
          ? { expiresAt: exception.expiresAt.toISOString() }
          : {}),
        ...(exception.revokedAt
          ? { revokedAt: exception.revokedAt.toISOString() }
          : {}),
        ...(exception.revokedByIdentityId !== undefined
          ? { revokedByIdentityId: exception.revokedByIdentityId ?? null }
          : {}),
        ...(exception.revocationReason !== undefined
          ? { revocationReason: exception.revocationReason ?? null }
          : {}),
      })),
      credentials,
      obligations,
      ...(reportLifecycle ? { reportLifecycle } : {}),
      ...(reportFilingPackage ? { reportFilingPackage } : {}),
      trustAnchors,
    };
  }

  private async buildCredentialEvidenceLineage(
    receipt: PolicyDecisionReceipt,
  ): Promise<CredentialEvidenceLineageSnapshot[]> {
    const metadata = this.asRecord(receipt.metadata);
    const credentialReferences = this.normalizeCredentialEvidenceReferences(
      metadata.credentialEvidenceRefs,
    );
    const credentialUsage = this.normalizeCredentialEvidenceUsage(
      metadata.credentialEvidenceUsage,
    );
    if (credentialReferences.length === 0) {
      return [];
    }

    const exports = await Promise.all(
      credentialReferences.map(async (reference) => {
        try {
          const exported = await credentialService.exportCredentialEvidence(
            reference.credentialId,
          );
          return this.sanitizeCredentialEvidenceLineage(
            exported,
            credentialUsage.find(
              (usage) => usage.credentialId === reference.credentialId,
            ),
          );
        } catch {
          return null;
        }
      }),
    );

    return exports.filter(
      (entry): entry is CredentialEvidenceLineageSnapshot => entry !== null,
    );
  }

  private buildObligationEvidenceLineage(
    receipt: PolicyDecisionReceipt,
  ): ObligationEvidenceLineageSnapshot[] {
    const metadata = this.asRecord(receipt.metadata);
    return this.normalizeObligationEvidenceUsage(
      metadata.obligationEvidenceUsage,
    );
  }

  private buildReportLifecycleLineage(
    receipt: PolicyDecisionReceipt,
  ): ReportLifecycleLineageSnapshot | undefined {
    const metadata = this.asRecord(receipt.metadata);
    return this.normalizeReportLifecycle(metadata.reportLifecycle);
  }

  private buildReportFilingPackageLineage(
    receipt: PolicyDecisionReceipt,
  ): ReportFilingPackageLineageSnapshot | undefined {
    const metadata = this.asRecord(receipt.metadata);
    return this.normalizeReportFilingPackage(metadata.reportFilingPackage);
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
    const issuerIdentityIds = [
      ...new Set(anchors.map((anchor) => anchor.issuerIdentityId)),
    ];
    const trustRecordIds = [
      ...new Set(
        anchors
          .map((anchor) => anchor.trustRecordId)
          .filter(
            (trustRecordId): trustRecordId is string =>
              typeof trustRecordId === 'string' && trustRecordId.length > 0,
          ),
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
          orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }],
        })
      : [];

    return anchors.map((anchor) => {
      const trustRecord =
        trustRecordIds.length > 0 && anchor.trustRecordId
          ? trustRecords.find(
              (record: any) => record.id === anchor.trustRecordId,
            )
          : trustRecords.find(
              (record: any) =>
                record.issuerIdentityId === anchor.issuerIdentityId,
            );
      const issuerKeyHistory = keyHistory.filter(
        (record: any) => record.issuerIdentityId === anchor.issuerIdentityId,
      );
      const currentKey =
        issuerKeyHistory.find(
          (record: any) =>
            String(record.status ?? '').toUpperCase() === 'ACTIVE',
        ) ?? issuerKeyHistory[0];

      return {
        issuerIdentityId: anchor.issuerIdentityId,
        issuerDid: anchor.issuerDid,
        ...(anchor.issuerDisplayName !== undefined
          ? { issuerDisplayName: anchor.issuerDisplayName }
          : {}),
        accepted: anchor.accepted,
        evaluatedCredentialTypes: anchor.evaluatedCredentialTypes,
        matchedJurisdictions: anchor.matchedJurisdictions,
        trustRegime: {
          status: trustRecord
            ? String(trustRecord.status ?? anchor.status).toLowerCase()
            : anchor.status,
          ...(trustRecord?.accreditationScope !== undefined
            ? {
                accreditationScope: String(
                  trustRecord.accreditationScope,
                ).toLowerCase(),
              }
            : anchor.accreditationScope
              ? { accreditationScope: anchor.accreditationScope }
              : {}),
          ...(trustRecord?.assuranceLevel !== undefined
            ? {
                assuranceLevel: String(
                  trustRecord.assuranceLevel,
                ).toLowerCase(),
              }
            : anchor.assuranceLevel
              ? { assuranceLevel: anchor.assuranceLevel }
              : {}),
          ...(trustRecord?.expiresAt
            ? { expiresAt: new Date(trustRecord.expiresAt).toISOString() }
            : anchor.expiresAt
              ? { expiresAt: anchor.expiresAt }
              : {}),
        },
        ...(trustRecord
          ? {
              trustRecord: this.serializeTrustAnchorTrustRecord(trustRecord),
            }
          : {}),
        ...(issuerKeyHistory.length > 0
          ? {
              keyLineage: {
                ...(currentKey
                  ? { current: this.serializeTrustAnchorKeyHistory(currentKey) }
                  : {}),
                history: issuerKeyHistory.map((record: any) =>
                  this.serializeTrustAnchorKeyHistory(record),
                ),
              },
            }
          : {}),
      };
    });
  }

  private buildOperatingRegimeSnapshot(
    receipt: PolicyDecisionReceipt,
  ): PolicyDecisionReceiptExport['operatingRegime'] | undefined {
    const metadata = this.asRecord(receipt.metadata);
    const governanceContext = this.asRecord(
      metadata.organizationGovernanceContext,
    );
    const policyExecutionTrace = this.asRecord(metadata.policyExecutionTrace);
    const governanceOverlay = this.asRecord(
      policyExecutionTrace.governanceOverlay,
    );
    if (
      Object.keys(governanceContext).length === 0 &&
      Object.keys(governanceOverlay).length === 0
    ) {
      return undefined;
    }

    const snapshot: OrganizationGovernanceSnapshot = {
      ...(this.normalizePackSelection(governanceContext.defaultPack)
        ? {
            defaultPack: this.normalizePackSelection(
              governanceContext.defaultPack,
            ),
          }
        : {}),
      ...(this.normalizeFamilyPackSelections(governanceContext.familyPacks)
        ? {
            familyPacks: this.normalizeFamilyPackSelections(
              governanceContext.familyPacks,
            ),
          }
        : {}),
      ...(typeof governanceContext.lastUpdatedAt === 'string' &&
      governanceContext.lastUpdatedAt.length > 0
        ? { lastUpdatedAt: governanceContext.lastUpdatedAt }
        : {}),
      ...(typeof governanceContext.lastUpdatedByIdentityId === 'string' &&
      governanceContext.lastUpdatedByIdentityId.length > 0
        ? { lastUpdatedByIdentityId: governanceContext.lastUpdatedByIdentityId }
        : {}),
      ...(this.normalizeActivePack(governanceContext.activePack)
        ? { activePack: this.normalizeActivePack(governanceContext.activePack) }
        : {}),
      ...(this.normalizeGovernanceChangeHistory(governanceContext.changeHistory)
        .length > 0
        ? {
            changeHistory: this.normalizeGovernanceChangeHistory(
              governanceContext.changeHistory,
            ),
          }
        : {}),
    };
    const runtimeOverlay =
      this.normalizeRuntimeGovernanceOverlay(governanceOverlay);

    if (Object.keys(snapshot).length === 0 && !runtimeOverlay) {
      return undefined;
    }

    return {
      ...(Object.keys(snapshot).length > 0
        ? { organizationGovernance: snapshot }
        : {}),
      ...(runtimeOverlay ? { runtimeOverlay } : {}),
    };
  }

  private normalizeReceipt(
    receipt: PolicyDecisionReceipt,
  ): PolicyDecisionReceipt {
    const policyExceptionIds = this.normalizePolicyExceptionIds(
      receipt.policyExceptionIds,
    );
    return {
      ...receipt,
      ...(receipt.policyDefinitionId
        ? { policyDefinitionId: receipt.policyDefinitionId }
        : {}),
      ...(receipt.policyReference
        ? { policyReference: receipt.policyReference }
        : {}),
      ...(receipt.policyApprovedByIdentityId
        ? { policyApprovedByIdentityId: receipt.policyApprovedByIdentityId }
        : {}),
      ...(receipt.policyEffectiveFrom
        ? { policyEffectiveFrom: receipt.policyEffectiveFrom }
        : {}),
      ...(receipt.policyExpiresAt
        ? { policyExpiresAt: receipt.policyExpiresAt }
        : {}),
      ...(receipt.policyGovernancePackId
        ? { policyGovernancePackId: receipt.policyGovernancePackId }
        : {}),
      ...(receipt.policyGovernancePackVersion
        ? { policyGovernancePackVersion: receipt.policyGovernancePackVersion }
        : {}),
      ...(receipt.policyGovernancePackLabel
        ? { policyGovernancePackLabel: receipt.policyGovernancePackLabel }
        : {}),
      ...(receipt.policyGovernanceProfileId
        ? { policyGovernanceProfileId: receipt.policyGovernanceProfileId }
        : {}),
      ...(receipt.policyGovernanceProfileLabel
        ? { policyGovernanceProfileLabel: receipt.policyGovernanceProfileLabel }
        : {}),
      ...(receipt.policyGovernanceRationale &&
      receipt.policyGovernanceRationale.length > 0
        ? {
            policyGovernanceRationale: this.normalizeGovernanceRationale(
              receipt.policyGovernanceRationale,
            ),
          }
        : {}),
      policyExceptionIds,
      policyExceptionCount:
        typeof receipt.policyExceptionCount === 'number'
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
      policyApprovedByIdentityId:
        record.policyApprovedByIdentityId ?? undefined,
      policyEffectiveFrom: record.policyEffectiveFrom
        ? record.policyEffectiveFrom.toISOString()
        : undefined,
      policyExpiresAt: record.policyExpiresAt
        ? record.policyExpiresAt.toISOString()
        : undefined,
      policyGovernancePackId: record.policyGovernancePackId ?? undefined,
      policyGovernancePackVersion:
        record.policyGovernancePackVersion ?? undefined,
      policyGovernancePackLabel: record.policyGovernancePackLabel ?? undefined,
      policyGovernanceProfileId: record.policyGovernanceProfileId ?? undefined,
      policyGovernanceProfileLabel:
        record.policyGovernanceProfileLabel ?? undefined,
      ...(Array.isArray(record.policyGovernanceRationale) &&
      record.policyGovernanceRationale.length > 0
        ? {
            policyGovernanceRationale: this.normalizeGovernanceRationale(
              record.policyGovernanceRationale,
            ),
          }
        : {}),
      subjectEntityId: record.subjectEntityId ?? undefined,
      policyExceptionIds: Array.isArray(record.policyExceptionIds)
        ? record.policyExceptionIds
        : [],
      policyExceptionCount:
        typeof record.policyExceptionCount === 'number'
          ? record.policyExceptionCount
          : Array.isArray(record.policyExceptionIds)
            ? record.policyExceptionIds.length
            : 0,
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

    return [
      ...new Set(
        value
          .map((entry) => String(entry).trim())
          .filter((entry) => entry.length > 0),
      ),
    ];
  }

  private normalizePackSelection(
    value: unknown,
  ): GovernancePackSelectionSnapshot | undefined {
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
    const normalized = Object.entries(record).reduce<
      Record<string, GovernancePackSelectionSnapshot>
    >((acc, [key, selection]) => {
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
      ...(typeof record.policyFamily === 'string' &&
      record.policyFamily.length > 0
        ? { policyFamily: record.policyFamily }
        : {}),
    };
  }

  private normalizeGovernanceChangeHistory(
    value: unknown,
  ): GovernanceChangeSnapshot[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => this.asRecord(entry))
      .map((entry) => ({
        changedAt: typeof entry.changedAt === 'string' ? entry.changedAt : '',
        changedByIdentityId:
          typeof entry.changedByIdentityId === 'string'
            ? entry.changedByIdentityId
            : '',
        ...(typeof entry.changeReason === 'string' &&
        entry.changeReason.length > 0
          ? { changeReason: entry.changeReason }
          : {}),
        ...(this.normalizePackSelection(entry.defaultPack)
          ? { defaultPack: this.normalizePackSelection(entry.defaultPack) }
          : {}),
        ...(this.normalizeFamilyPackSelections(entry.familyPacks)
          ? {
              familyPacks: this.normalizeFamilyPackSelections(
                entry.familyPacks,
              ),
            }
          : {}),
      }))
      .filter(
        (entry) =>
          entry.changedAt.length > 0 && entry.changedByIdentityId.length > 0,
      )
      .slice(-5);
  }

  private normalizeRuntimeGovernanceOverlay(
    value: unknown,
  ): RuntimeGovernanceOverlaySnapshot | undefined {
    const record = this.asRecord(value);
    if (typeof record.packId !== 'string' || record.packId.length === 0) {
      return undefined;
    }

    const directives = this.normalizeStringArray(record.directives);
    if (directives.length === 0) {
      return undefined;
    }

    const appliedDirectives = this.normalizeStringArray(
      record.appliedDirectives,
    );
    return {
      packId: record.packId,
      ...(typeof record.packVersion === 'string' &&
      record.packVersion.length > 0
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
        issuerIdentityId:
          typeof entry.issuerIdentityId === 'string'
            ? entry.issuerIdentityId
            : '',
        issuerDid: typeof entry.issuerDid === 'string' ? entry.issuerDid : '',
        ...(entry.issuerDisplayName === null ||
        typeof entry.issuerDisplayName === 'string'
          ? { issuerDisplayName: entry.issuerDisplayName as string | null }
          : {}),
        ...(typeof entry.trustRecordId === 'string' &&
        entry.trustRecordId.length > 0
          ? { trustRecordId: entry.trustRecordId }
          : {}),
        status: typeof entry.status === 'string' ? entry.status : 'untracked',
        ...(typeof entry.accreditationScope === 'string' &&
        entry.accreditationScope.length > 0
          ? { accreditationScope: entry.accreditationScope }
          : {}),
        ...(typeof entry.assuranceLevel === 'string' &&
        entry.assuranceLevel.length > 0
          ? { assuranceLevel: entry.assuranceLevel }
          : {}),
        accepted: Boolean(entry.accepted),
        evaluatedCredentialTypes: this.normalizeStringArray(
          entry.evaluatedCredentialTypes,
        ),
        matchedJurisdictions: this.normalizeStringArray(
          entry.matchedJurisdictions,
        ),
        ...(typeof entry.expiresAt === 'string' && entry.expiresAt.length > 0
          ? { expiresAt: entry.expiresAt }
          : {}),
      }))
      .filter((entry) => entry.issuerIdentityId.length > 0);
  }

  private normalizeCredentialEvidenceReferences(
    value: unknown,
  ): ReceiptCredentialEvidenceReference[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => this.asRecord(entry))
      .map((entry) => ({
        credentialId:
          typeof entry.credentialId === 'string' ? entry.credentialId : '',
        issuerId: typeof entry.issuerId === 'string' ? entry.issuerId : '',
        credentialType:
          typeof entry.credentialType === 'string' ? entry.credentialType : '',
      }))
      .filter((entry) => entry.credentialId.length > 0)
      .reduce<ReceiptCredentialEvidenceReference[]>((acc, entry) => {
        if (
          !acc.some((existing) => existing.credentialId === entry.credentialId)
        ) {
          acc.push(entry);
        }
        return acc;
      }, []);
  }

  private normalizeCredentialEvidenceUsage(
    value: unknown,
  ): ReceiptCredentialEvidenceUsageSnapshot[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => this.asRecord(entry))
      .map((entry) => ({
        credentialId:
          typeof entry.credentialId === 'string' ? entry.credentialId : '',
        issuerId: typeof entry.issuerId === 'string' ? entry.issuerId : '',
        credentialType:
          typeof entry.credentialType === 'string' ? entry.credentialType : '',
        ...(typeof entry.operationType === 'string' &&
        entry.operationType.length > 0
          ? { operationType: entry.operationType }
          : {}),
        rulePaths: Array.isArray(entry.rulePaths)
          ? entry.rulePaths
              .map((rulePath) => this.asRecord(rulePath))
              .map((rulePath) => ({
                jurisdiction:
                  typeof rulePath.jurisdiction === 'string'
                    ? rulePath.jurisdiction
                    : '',
                rulePath:
                  typeof rulePath.rulePath === 'string'
                    ? rulePath.rulePath
                    : '',
                status:
                  rulePath.status === 'satisfied'
                    ? ('satisfied' as const)
                    : ('supplemental' as const),
              }))
              .filter(
                (rulePath) =>
                  rulePath.jurisdiction.length > 0 &&
                  rulePath.rulePath.length > 0,
              )
          : [],
      }))
      .filter((entry) => entry.credentialId.length > 0);
  }

  private normalizeObligationEvidenceUsage(
    value: unknown,
  ): ObligationEvidenceLineageSnapshot[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => this.asRecord(entry))
      .map((entry) => ({
        domain:
          entry.domain === 'cross_border'
            ? ('cross_border' as const)
            : entry.domain === 'privacy'
              ? ('privacy' as const)
              : ('reporting' as const),
        obligationType:
          typeof entry.obligationType === 'string' ? entry.obligationType : '',
        rulePath: typeof entry.rulePath === 'string' ? entry.rulePath : '',
        status:
          entry.status === 'escalated'
            ? ('escalated' as const)
            : ('satisfied' as const),
        ...(typeof entry.detail === 'string' && entry.detail.length > 0
          ? { detail: entry.detail }
          : {}),
        ...(typeof entry.sourceJurisdiction === 'string' &&
        entry.sourceJurisdiction.length > 0
          ? { sourceJurisdiction: entry.sourceJurisdiction }
          : {}),
        ...(typeof entry.targetJurisdiction === 'string' &&
        entry.targetJurisdiction.length > 0
          ? { targetJurisdiction: entry.targetJurisdiction }
          : {}),
        ...(typeof entry.jurisdiction === 'string' &&
        entry.jurisdiction.length > 0
          ? { jurisdiction: entry.jurisdiction }
          : {}),
        ...(typeof entry.reportType === 'string' && entry.reportType.length > 0
          ? { reportType: entry.reportType }
          : {}),
      }))
      .filter(
        (entry) => entry.obligationType.length > 0 && entry.rulePath.length > 0,
      )
      .reduce<ObligationEvidenceLineageSnapshot[]>((acc, entry) => {
        if (
          !acc.some(
            (existing) =>
              existing.domain === entry.domain &&
              existing.obligationType === entry.obligationType &&
              existing.rulePath === entry.rulePath &&
              existing.status === entry.status &&
              existing.detail === entry.detail &&
              existing.sourceJurisdiction === entry.sourceJurisdiction &&
              existing.targetJurisdiction === entry.targetJurisdiction &&
              existing.jurisdiction === entry.jurisdiction &&
              existing.reportType === entry.reportType,
          )
        ) {
          acc.push(entry);
        }
        return acc;
      }, []);
  }

  private normalizeReportLifecycle(
    value: unknown,
  ): ReportLifecycleLineageSnapshot | undefined {
    const record = this.asRecord(value);
    const action = typeof record.action === 'string' ? record.action : '';
    const reportId = typeof record.reportId === 'string' ? record.reportId : '';
    const reportType =
      typeof record.reportType === 'string' ? record.reportType : '';
    const filingJurisdiction =
      typeof record.filingJurisdiction === 'string'
        ? record.filingJurisdiction
        : '';
    const status = typeof record.status === 'string' ? record.status : '';
    const version =
      typeof record.version === 'number' ? record.version : Number.NaN;

    if (
      !['generated', 'submitted', 'amended', 'exported'].includes(action) ||
      reportId.length === 0 ||
      reportType.length === 0 ||
      filingJurisdiction.length === 0 ||
      status.length === 0 ||
      Number.isNaN(version)
    ) {
      return undefined;
    }

    return {
      action: action as ReportLifecycleLineageSnapshot['action'],
      reportId,
      reportType,
      version,
      status,
      filingJurisdiction,
      ...(typeof record.authority === 'string' && record.authority.length > 0
        ? { authority: record.authority }
        : {}),
      ...(record.filingReference === null ||
      (typeof record.filingReference === 'string' &&
        record.filingReference.length > 0)
        ? { filingReference: record.filingReference as string | null }
        : {}),
      ...(record.deadlineField === 'filingDeadline' ||
      record.deadlineField === 'responseDeadline'
        ? {
            deadlineField: record.deadlineField as
              | 'filingDeadline'
              | 'responseDeadline',
          }
        : {}),
      ...(typeof record.deadline === 'string' && record.deadline.length > 0
        ? { deadline: record.deadline }
        : {}),
      ...(record.submittedAt === null ||
      (typeof record.submittedAt === 'string' && record.submittedAt.length > 0)
        ? { submittedAt: record.submittedAt as string | null }
        : {}),
      ...(typeof record.amendmentCount === 'number'
        ? { amendmentCount: record.amendmentCount }
        : {}),
      ...(typeof record.amendmentReason === 'string' &&
      record.amendmentReason.length > 0
        ? { amendmentReason: record.amendmentReason }
        : {}),
      ...(typeof record.amendedAt === 'string' && record.amendedAt.length > 0
        ? { amendedAt: record.amendedAt }
        : {}),
      ...(typeof record.exportFormat === 'string' &&
      record.exportFormat.length > 0
        ? { exportFormat: record.exportFormat }
        : {}),
      ...(typeof record.exportFilename === 'string' &&
      record.exportFilename.length > 0
        ? { exportFilename: record.exportFilename }
        : {}),
      ...(typeof record.exportRequestedAt === 'string' &&
      record.exportRequestedAt.length > 0
        ? { exportRequestedAt: record.exportRequestedAt }
        : {}),
      ...(Array.isArray(record.amendmentHistory)
        ? {
            amendmentHistory: record.amendmentHistory
              .map((entry) => this.asRecord(entry))
              .map((entry) => ({
                version:
                  typeof entry.version === 'number'
                    ? entry.version
                    : Number.NaN,
                amendedAt:
                  typeof entry.amendedAt === 'string' ? entry.amendedAt : '',
                reason: typeof entry.reason === 'string' ? entry.reason : '',
              }))
              .filter(
                (entry) =>
                  !Number.isNaN(entry.version) &&
                  entry.amendedAt.length > 0 &&
                  entry.reason.length > 0,
              ),
          }
        : {}),
      ...(typeof record.deliveryChannel === 'string' &&
      record.deliveryChannel.length > 0
        ? { deliveryChannel: record.deliveryChannel }
        : {}),
      ...(typeof record.deliveryDestination === 'string' &&
      record.deliveryDestination.length > 0
        ? { deliveryDestination: record.deliveryDestination }
        : {}),
      ...(typeof record.deliveryAcknowledgementId === 'string' &&
      record.deliveryAcknowledgementId.length > 0
        ? { deliveryAcknowledgementId: record.deliveryAcknowledgementId }
        : {}),
      ...(typeof record.deliveryAcknowledgedAt === 'string' &&
      record.deliveryAcknowledgedAt.length > 0
        ? { deliveryAcknowledgedAt: record.deliveryAcknowledgedAt }
        : {}),
    };
  }

  private normalizeReportFilingPackage(
    value: unknown,
  ): ReportFilingPackageLineageSnapshot | undefined {
    const record = this.asRecord(value);
    const packageVersion =
      typeof record.packageVersion === 'string' ? record.packageVersion : '';
    const reportId = typeof record.reportId === 'string' ? record.reportId : '';
    const reportType =
      typeof record.reportType === 'string' ? record.reportType : '';
    const filingJurisdiction =
      typeof record.filingJurisdiction === 'string'
        ? record.filingJurisdiction
        : '';
    const status = typeof record.status === 'string' ? record.status : '';
    const version =
      typeof record.version === 'number' ? record.version : Number.NaN;
    const lifecycle = this.asRecord(record.lifecycle);
    const authorityProfile = this.asRecord(record.authorityProfile);
    const deadline = this.asRecord(record.deadline);

    if (
      packageVersion !== 'zeroid.regulatory_filing_package.v1' ||
      reportId.length === 0 ||
      reportType.length === 0 ||
      filingJurisdiction.length === 0 ||
      status.length === 0 ||
      Number.isNaN(version) ||
      typeof lifecycle.generatedAt !== 'string' ||
      lifecycle.generatedAt.length === 0 ||
      typeof lifecycle.amendmentCount !== 'number'
    ) {
      return undefined;
    }

    const normalizedTrail = Array.isArray(record.evidenceTrail)
      ? record.evidenceTrail
          .map((entry) => this.asRecord(entry))
          .map((entry) => {
            const action = typeof entry.action === 'string' ? entry.action : '';
            const recordedAt =
              typeof entry.recordedAt === 'string' ? entry.recordedAt : '';
            const policyName =
              typeof entry.policyName === 'string' ? entry.policyName : '';
            const eventVersion =
              typeof entry.version === 'number' ? entry.version : Number.NaN;
            if (
              ![
                'generated',
                'submitted',
                'amended',
                'exported',
                'acknowledged',
              ].includes(action) ||
              recordedAt.length === 0 ||
              policyName.length === 0 ||
              Number.isNaN(eventVersion)
            ) {
              return null;
            }

            return {
              ...(typeof entry.eventId === 'string' && entry.eventId.length > 0
                ? { eventId: entry.eventId }
                : {}),
              action: action as ReportEvidenceEventLineageSnapshot['action'],
              recordedAt,
              ...(typeof entry.receiptId === 'string' &&
              entry.receiptId.length > 0
                ? { receiptId: entry.receiptId }
                : {}),
              ...(typeof entry.actorIdentityId === 'string' &&
              entry.actorIdentityId.length > 0
                ? { actorIdentityId: entry.actorIdentityId }
                : {}),
              policyName,
              ...(typeof entry.policyVersion === 'string' &&
              entry.policyVersion.length > 0
                ? { policyVersion: entry.policyVersion }
                : {}),
              ...(typeof entry.decisionSummary === 'string' &&
              entry.decisionSummary.length > 0
                ? { decisionSummary: entry.decisionSummary }
                : {}),
              ...(typeof entry.authority === 'string' &&
              entry.authority.length > 0
                ? { authority: entry.authority }
                : {}),
              ...(entry.filingReference === null ||
              (typeof entry.filingReference === 'string' &&
                entry.filingReference.length > 0)
                ? { filingReference: entry.filingReference as string | null }
                : {}),
              version: eventVersion,
              ...(typeof entry.amendmentReason === 'string' &&
              entry.amendmentReason.length > 0
                ? { amendmentReason: entry.amendmentReason }
                : {}),
              ...(typeof entry.exportFormat === 'string' &&
              entry.exportFormat.length > 0
                ? { exportFormat: entry.exportFormat }
                : {}),
              ...(typeof entry.exportFilename === 'string' &&
              entry.exportFilename.length > 0
                ? { exportFilename: entry.exportFilename }
                : {}),
              ...(typeof entry.deliveryChannel === 'string' &&
              entry.deliveryChannel.length > 0
                ? { deliveryChannel: entry.deliveryChannel }
                : {}),
              ...(typeof entry.deliveryDestination === 'string' &&
              entry.deliveryDestination.length > 0
                ? { deliveryDestination: entry.deliveryDestination }
                : {}),
              ...(typeof entry.deliveryAcknowledgementId === 'string' &&
              entry.deliveryAcknowledgementId.length > 0
                ? { deliveryAcknowledgementId: entry.deliveryAcknowledgementId }
                : {}),
              ...(typeof entry.deliveryAcknowledgedAt === 'string' &&
              entry.deliveryAcknowledgedAt.length > 0
                ? { deliveryAcknowledgedAt: entry.deliveryAcknowledgedAt }
                : {}),
            } satisfies ReportEvidenceEventLineageSnapshot;
          })
          .filter(
            (entry): entry is ReportEvidenceEventLineageSnapshot =>
              entry !== null,
          )
      : [];

    return {
      packageVersion: 'zeroid.regulatory_filing_package.v1',
      reportId,
      reportType,
      version,
      status,
      filingJurisdiction,
      ...(typeof authorityProfile.authority === 'string' &&
      authorityProfile.authority.length > 0 &&
      typeof authorityProfile.jurisdiction === 'string' &&
      authorityProfile.jurisdiction.length > 0 &&
      typeof authorityProfile.reportType === 'string' &&
      authorityProfile.reportType.length > 0 &&
      [
        'financial_intelligence_unit',
        'market_regulator',
        'data_protection_authority',
        'audit_supervisor',
        'general_regulator',
      ].includes(String(authorityProfile.authorityClass)) &&
      [
        'aml_filing',
        'privacy_rights',
        'audit_package',
        'general_reporting',
      ].includes(String(authorityProfile.packageProfile))
        ? {
            authorityProfile: {
              authority: authorityProfile.authority,
              authorityClass:
                authorityProfile.authorityClass as ReportAuthorityProfileLineageSnapshot['authorityClass'],
              packageProfile:
                authorityProfile.packageProfile as ReportAuthorityProfileLineageSnapshot['packageProfile'],
              jurisdiction: authorityProfile.jurisdiction,
              reportType: authorityProfile.reportType,
              preferredDeliveryChannels: Array.isArray(
                authorityProfile.preferredDeliveryChannels,
              )
                ? authorityProfile.preferredDeliveryChannels.filter(
                    (
                      channel,
                    ): channel is 'portal_upload' | 'api' | 'sftp' | 'email' =>
                      channel === 'portal_upload' ||
                      channel === 'api' ||
                      channel === 'sftp' ||
                      channel === 'email',
                  )
                : [],
              acknowledgementExpected:
                authorityProfile.acknowledgementExpected === true,
              supportsAmendments: authorityProfile.supportsAmendments === true,
              supportsExports: authorityProfile.supportsExports === true,
            },
          }
        : {}),
      ...(deadline.field === 'filingDeadline' ||
      deadline.field === 'responseDeadline'
        ? {
            deadline: {
              field:
                deadline.field as ReportFilingDeadlineLineageSnapshot['field'],
              value: typeof deadline.value === 'string' ? deadline.value : '',
              status:
                deadline.status === 'met' || deadline.status === 'overdue'
                  ? deadline.status
                  : 'pending',
              evaluatedAt:
                typeof deadline.evaluatedAt === 'string'
                  ? deadline.evaluatedAt
                  : '',
              ...(typeof deadline.remainingHours === 'number'
                ? { remainingHours: deadline.remainingHours }
                : {}),
              ...(typeof deadline.submittedOnTime === 'boolean'
                ? { submittedOnTime: deadline.submittedOnTime }
                : {}),
            },
          }
        : {}),
      ...(typeof this.asRecord(record.authorityManifest).manifestVersion ===
      'string'
        ? {
            authorityManifest: this.normalizeAuthorityManifestLineage(
              record.authorityManifest,
            ),
          }
        : {}),
      lifecycle: {
        generatedAt: lifecycle.generatedAt,
        ...(lifecycle.submittedAt === null ||
        (typeof lifecycle.submittedAt === 'string' &&
          lifecycle.submittedAt.length > 0)
          ? { submittedAt: lifecycle.submittedAt as string | null }
          : {}),
        ...(lifecycle.filingReference === null ||
        (typeof lifecycle.filingReference === 'string' &&
          lifecycle.filingReference.length > 0)
          ? { filingReference: lifecycle.filingReference as string | null }
          : {}),
        amendmentCount: lifecycle.amendmentCount,
        ...(this.asRecord(lifecycle.latestAmendment) &&
        typeof this.asRecord(lifecycle.latestAmendment).version === 'number' &&
        typeof this.asRecord(lifecycle.latestAmendment).amendedAt ===
          'string' &&
        typeof this.asRecord(lifecycle.latestAmendment).reason === 'string'
          ? {
              latestAmendment: {
                version: this.asRecord(lifecycle.latestAmendment)
                  .version as number,
                amendedAt: this.asRecord(lifecycle.latestAmendment)
                  .amendedAt as string,
                reason: this.asRecord(lifecycle.latestAmendment)
                  .reason as string,
              },
            }
          : {}),
        ...(typeof lifecycle.lastExportedAt === 'string' &&
        lifecycle.lastExportedAt.length > 0
          ? { lastExportedAt: lifecycle.lastExportedAt }
          : {}),
        ...(typeof lifecycle.lastExportFormat === 'string' &&
        lifecycle.lastExportFormat.length > 0
          ? { lastExportFormat: lifecycle.lastExportFormat }
          : {}),
        ...(typeof lifecycle.lastExportFilename === 'string' &&
        lifecycle.lastExportFilename.length > 0
          ? { lastExportFilename: lifecycle.lastExportFilename }
          : {}),
        ...(typeof lifecycle.lastDeliveryChannel === 'string' &&
        lifecycle.lastDeliveryChannel.length > 0
          ? { lastDeliveryChannel: lifecycle.lastDeliveryChannel }
          : {}),
        ...(typeof lifecycle.lastDeliveryDestination === 'string' &&
        lifecycle.lastDeliveryDestination.length > 0
          ? { lastDeliveryDestination: lifecycle.lastDeliveryDestination }
          : {}),
        ...(typeof lifecycle.lastDeliveryAcknowledgementId === 'string' &&
        lifecycle.lastDeliveryAcknowledgementId.length > 0
          ? {
              lastDeliveryAcknowledgementId:
                lifecycle.lastDeliveryAcknowledgementId,
            }
          : {}),
        ...(typeof lifecycle.lastDeliveryAcknowledgedAt === 'string' &&
        lifecycle.lastDeliveryAcknowledgedAt.length > 0
          ? { lastDeliveryAcknowledgedAt: lifecycle.lastDeliveryAcknowledgedAt }
          : {}),
      },
      evidenceTrail: normalizedTrail,
    };
  }

  private normalizeAuthorityManifestLineage(
    value: unknown,
  ): ReportFilingPackageLineageSnapshot['authorityManifest'] | undefined {
    const record = this.asRecord(value);
    if (
      record.manifestVersion !== 'zeroid.report_authority_manifest.v1' ||
      typeof record.reportId !== 'string' ||
      typeof record.reportType !== 'string' ||
      typeof record.filingJurisdiction !== 'string' ||
      typeof record.currentVersion !== 'number' ||
      !Array.isArray(record.supportedExportFormats) ||
      !Array.isArray(record.preferredDeliveryChannels) ||
      typeof record.acknowledgementExpected !== 'boolean' ||
      typeof record.lastUpdatedAt !== 'string'
    ) {
      return undefined;
    }

    type AuthorityManifestLineage = NonNullable<
      ReportFilingPackageLineageSnapshot['authorityManifest']
    >;

    const acknowledgements: AuthorityManifestLineage['acknowledgements'] =
      Array.isArray(record.acknowledgements)
        ? record.acknowledgements
            .map((entry) => this.asRecord(entry))
            .map(
              (entry): AuthorityManifestLineage['acknowledgements'][number] => {
                const stage: AuthorityManifestLineage['acknowledgements'][number]['stage'] =
                  entry.stage === 'submitted' || entry.stage === 'amended'
                    ? entry.stage
                    : 'exported';
                return {
                  acknowledgementId:
                    typeof entry.acknowledgementId === 'string'
                      ? entry.acknowledgementId
                      : '',
                  stage,
                  acknowledgedAt:
                    typeof entry.acknowledgedAt === 'string'
                      ? entry.acknowledgedAt
                      : '',
                  ...(typeof entry.channel === 'string' &&
                  entry.channel.length > 0
                    ? { channel: entry.channel }
                    : {}),
                  ...(typeof entry.destination === 'string' &&
                  entry.destination.length > 0
                    ? { destination: entry.destination }
                    : {}),
                  ...(typeof entry.authority === 'string' &&
                  entry.authority.length > 0
                    ? { authority: entry.authority }
                    : {}),
                };
              },
            )
            .filter(
              (entry) =>
                entry.acknowledgementId.length > 0 &&
                entry.acknowledgedAt.length > 0,
            )
        : [];

    const handoffTrail: AuthorityManifestLineage['handoffTrail'] =
      Array.isArray(record.handoffTrail)
        ? record.handoffTrail
            .map((entry) => this.asRecord(entry))
            .map((entry): AuthorityManifestLineage['handoffTrail'][number] => {
              const stage: AuthorityManifestLineage['handoffTrail'][number]['stage'] =
                entry.stage === 'submitted' ||
                entry.stage === 'amended' ||
                entry.stage === 'exported'
                  ? entry.stage
                  : 'acknowledged';
              return {
                eventId: typeof entry.eventId === 'string' ? entry.eventId : '',
                stage,
                recordedAt:
                  typeof entry.recordedAt === 'string' ? entry.recordedAt : '',
                ...(entry.acknowledgementStage === 'submitted' ||
                entry.acknowledgementStage === 'amended' ||
                entry.acknowledgementStage === 'exported'
                  ? {
                      acknowledgementStage: entry.acknowledgementStage as
                        | 'submitted'
                        | 'amended'
                        | 'exported',
                    }
                  : {}),
                ...(typeof entry.actorIdentityId === 'string' &&
                entry.actorIdentityId.length > 0
                  ? { actorIdentityId: entry.actorIdentityId }
                  : {}),
                ...(typeof entry.policyName === 'string' &&
                entry.policyName.length > 0
                  ? { policyName: entry.policyName }
                  : {}),
                ...(typeof entry.policyVersion === 'string' &&
                entry.policyVersion.length > 0
                  ? { policyVersion: entry.policyVersion }
                  : {}),
                ...(typeof entry.authority === 'string' &&
                entry.authority.length > 0
                  ? { authority: entry.authority }
                  : {}),
                ...(entry.filingReference === null ||
                (typeof entry.filingReference === 'string' &&
                  entry.filingReference.length > 0)
                  ? { filingReference: entry.filingReference as string | null }
                  : {}),
                version:
                  typeof entry.version === 'number'
                    ? entry.version
                    : Number.NaN,
                ...(typeof entry.amendmentReason === 'string' &&
                entry.amendmentReason.length > 0
                  ? { amendmentReason: entry.amendmentReason }
                  : {}),
                ...(typeof entry.exportFormat === 'string' &&
                entry.exportFormat.length > 0
                  ? { exportFormat: entry.exportFormat }
                  : {}),
                ...(typeof entry.exportFilename === 'string' &&
                entry.exportFilename.length > 0
                  ? { exportFilename: entry.exportFilename }
                  : {}),
                ...(typeof entry.deliveryChannel === 'string' &&
                entry.deliveryChannel.length > 0
                  ? { deliveryChannel: entry.deliveryChannel }
                  : {}),
                ...(typeof entry.deliveryDestination === 'string' &&
                entry.deliveryDestination.length > 0
                  ? { deliveryDestination: entry.deliveryDestination }
                  : {}),
                ...(typeof entry.acknowledgementId === 'string' &&
                entry.acknowledgementId.length > 0
                  ? { acknowledgementId: entry.acknowledgementId }
                  : {}),
                ...(typeof entry.acknowledgedAt === 'string' &&
                entry.acknowledgedAt.length > 0
                  ? { acknowledgedAt: entry.acknowledgedAt }
                  : {}),
              };
            })
            .filter(
              (entry) =>
                entry.eventId.length > 0 &&
                entry.recordedAt.length > 0 &&
                !Number.isNaN(entry.version),
            )
        : [];

    return {
      manifestVersion: 'zeroid.report_authority_manifest.v1',
      reportId: record.reportId as string,
      reportType: record.reportType as string,
      filingJurisdiction: record.filingJurisdiction as string,
      ...(typeof record.authority === 'string' && record.authority.length > 0
        ? { authority: record.authority }
        : {}),
      ...(record.filingReference === null ||
      (typeof record.filingReference === 'string' &&
        record.filingReference.length > 0)
        ? { filingReference: record.filingReference as string | null }
        : {}),
      currentVersion: record.currentVersion as number,
      ...(record.submittedAt === null ||
      (typeof record.submittedAt === 'string' && record.submittedAt.length > 0)
        ? { submittedAt: record.submittedAt as string | null }
        : {}),
      supportedExportFormats: (
        record.supportedExportFormats as unknown[]
      ).filter(
        (entry): entry is string =>
          typeof entry === 'string' && entry.length > 0,
      ),
      preferredDeliveryChannels: (
        record.preferredDeliveryChannels as unknown[]
      ).filter(
        (entry): entry is 'portal_upload' | 'api' | 'sftp' | 'email' =>
          entry === 'portal_upload' ||
          entry === 'api' ||
          entry === 'sftp' ||
          entry === 'email',
      ),
      acknowledgementExpected: record.acknowledgementExpected as boolean,
      ...(this.asRecord(record.latestAmendment) &&
      typeof this.asRecord(record.latestAmendment).version === 'number' &&
      typeof this.asRecord(record.latestAmendment).amendedAt === 'string' &&
      typeof this.asRecord(record.latestAmendment).reason === 'string'
        ? {
            latestAmendment: {
              version: this.asRecord(record.latestAmendment).version as number,
              amendedAt: this.asRecord(record.latestAmendment)
                .amendedAt as string,
              reason: this.asRecord(record.latestAmendment).reason as string,
            },
          }
        : {}),
      ...(this.asRecord(record.latestExport) &&
      typeof this.asRecord(record.latestExport).format === 'string' &&
      typeof this.asRecord(record.latestExport).filename === 'string' &&
      typeof this.asRecord(record.latestExport).exportedAt === 'string'
        ? {
            latestExport: {
              format: this.asRecord(record.latestExport).format as string,
              filename: this.asRecord(record.latestExport).filename as string,
              exportedAt: this.asRecord(record.latestExport)
                .exportedAt as string,
              ...(typeof this.asRecord(record.latestExport).deliveryChannel ===
              'string'
                ? {
                    deliveryChannel: this.asRecord(record.latestExport)
                      .deliveryChannel as string,
                  }
                : {}),
              ...(typeof this.asRecord(record.latestExport)
                .deliveryDestination === 'string'
                ? {
                    deliveryDestination: this.asRecord(record.latestExport)
                      .deliveryDestination as string,
                  }
                : {}),
              ...(typeof this.asRecord(record.latestExport)
                .deliveryAcknowledgementId === 'string'
                ? {
                    deliveryAcknowledgementId: this.asRecord(
                      record.latestExport,
                    ).deliveryAcknowledgementId as string,
                  }
                : {}),
              ...(typeof this.asRecord(record.latestExport)
                .deliveryAcknowledgedAt === 'string'
                ? {
                    deliveryAcknowledgedAt: this.asRecord(record.latestExport)
                      .deliveryAcknowledgedAt as string,
                  }
                : {}),
            },
          }
        : {}),
      acknowledgements,
      handoffTrail,
      lastUpdatedAt: record.lastUpdatedAt as string,
    };
  }

  private sanitizeCredentialEvidenceLineage(
    exported: Awaited<
      ReturnType<typeof credentialService.exportCredentialEvidence>
    >,
    usage?: ReceiptCredentialEvidenceUsageSnapshot,
  ): CredentialEvidenceLineageSnapshot {
    return {
      credentialId: exported.credential.id,
      credentialType: exported.credential.credentialType,
      issuerId: exported.credential.issuerId,
      subjectId: exported.credential.subjectId,
      status: exported.credential.status,
      issuedAt:
        exported.credential.issuedAt instanceof Date
          ? exported.credential.issuedAt.toISOString()
          : String(exported.credential.issuedAt),
      ...(exported.credential.expiresAt
        ? {
            expiresAt:
              exported.credential.expiresAt instanceof Date
                ? exported.credential.expiresAt.toISOString()
                : String(exported.credential.expiresAt),
          }
        : {}),
      verification: exported.verification,
      issuer: exported.issuer,
      subject: exported.subject,
      ...(exported.trustLineage ? { trustLineage: exported.trustLineage } : {}),
      ...(usage
        ? {
            usage: {
              ...(usage.operationType
                ? { operationType: usage.operationType }
                : {}),
              rulePaths: usage.rulePaths,
            },
          }
        : {}),
    };
  }

  private serializeTrustAnchorTrustRecord(
    record: any,
  ): TrustAnchorLineageTrustRecord {
    return {
      trustRecordId: String(record.id),
      status: String(record.status ?? 'UNKNOWN').toLowerCase(),
      ...(record.accreditationScope !== undefined
        ? {
            accreditationScope: String(record.accreditationScope).toLowerCase(),
          }
        : {}),
      ...(record.assuranceLevel !== undefined
        ? { assuranceLevel: String(record.assuranceLevel).toLowerCase() }
        : {}),
      allowedCredentialTypes: this.normalizeStringArray(
        record.allowedCredentialTypes,
      ),
      allowedJurisdictions: this.normalizeStringArray(
        record.allowedJurisdictions,
      ),
      ...(record.proposedByIdentityId !== undefined
        ? { proposedByIdentityId: record.proposedByIdentityId ?? null }
        : {}),
      ...(record.accreditedByIdentityId !== undefined
        ? { accreditedByIdentityId: record.accreditedByIdentityId ?? null }
        : {}),
      ...(record.suspensionReason !== undefined
        ? { suspensionReason: record.suspensionReason ?? null }
        : {}),
      ...(record.metadata !== undefined && record.metadata !== null
        ? { metadata: this.asRecord(record.metadata) }
        : {}),
      ...(record.accreditedAt
        ? { accreditedAt: new Date(record.accreditedAt).toISOString() }
        : {}),
      ...(record.expiresAt
        ? { expiresAt: new Date(record.expiresAt).toISOString() }
        : {}),
      ...(record.updatedAt
        ? { updatedAt: new Date(record.updatedAt).toISOString() }
        : {}),
    };
  }

  private serializeTrustAnchorKeyHistory(
    record: any,
  ): TrustAnchorKeyHistorySnapshot {
    return {
      keyHistoryId: String(record.id),
      keyVersion: String(record.keyVersion),
      keyAlgorithm: String(record.keyAlgorithm),
      verificationMethod: String(record.verificationMethod),
      status: String(record.status ?? 'UNKNOWN').toLowerCase(),
      validFrom: new Date(record.validFrom).toISOString(),
      ...(record.validUntil
        ? { validUntil: new Date(record.validUntil).toISOString() }
        : {}),
      ...(record.rotatedByIdentityId !== undefined
        ? { rotatedByIdentityId: record.rotatedByIdentityId ?? null }
        : {}),
      ...(record.metadata !== undefined && record.metadata !== null
        ? { metadata: this.asRecord(record.metadata) }
        : {}),
      createdAt: new Date(record.createdAt).toISOString(),
    };
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter(
      (entry): entry is string => typeof entry === 'string' && entry.length > 0,
    );
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }
}

export const policyDecisionReceiptService = new PolicyDecisionReceiptService();
