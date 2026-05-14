import { prisma } from '../../index';
import type { EnterpriseApprovalClass, EnterpriseRole } from './organization-service';

export class PolicyContextError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'PolicyContextError';
  }
}

export interface PolicyDefinition {
  id?: string;
  policyName: string;
  version: string;
  reference: string;
  family: 'compliance' | 'reporting' | 'privacy' | 'screening';
  approvedByIdentityId?: string | null;
  approvalMode?: string;
  requiredApprovals?: number;
  requiredApprovalRoles?: EnterpriseRole[];
  requiredApprovalClasses?: EnterpriseApprovalClass[];
  requiredApprovalJurisdictions?: string[];
  governancePackId?: string;
  governancePackVersion?: string;
  governancePackLabel?: string;
  governanceProfileId?: string;
  governanceProfileLabel?: string;
  governanceProfileRationale?: string[];
  approvalTrail?: Array<{
    identityId: string;
    role: EnterpriseRole;
    approvalClasses: EnterpriseApprovalClass[];
    matchedApprovalClasses: EnterpriseApprovalClass[];
    matchedApprovalJurisdictions: string[];
    action: 'approve';
    decidedAt: string;
  }>;
  effectiveFrom?: string;
  expiresAt?: string;
  lifecycleStatus?: string;
  deprecatedAt?: string;
  deprecatedByIdentityId?: string | null;
  deprecationReason?: string | null;
  supersededByPolicyDefinitionId?: string | null;
  revokedAt?: string;
  revokedByIdentityId?: string | null;
  revocationReason?: string | null;
}

export interface CredentialTrustInput {
  issuerId: string;
  credentialType: string;
}

export interface PolicyTrustAnchorSnapshot {
  issuerIdentityId: string;
  issuerDid: string;
  issuerDisplayName: string | null;
  trustRecordId?: string;
  status: string;
  accreditationScope?: string;
  assuranceLevel?: string;
  accepted: boolean;
  evaluatedCredentialTypes: string[];
  matchedJurisdictions: string[];
  expiresAt?: string;
}

export interface PolicyExecutionContext {
  policyName: string;
  policyVersion: string;
  policyDefinitionId?: string;
  policyReference: string;
  policyFamily: PolicyDefinition['family'];
  policyApprovalContext?: {
    approvedByIdentityId: string | null;
    approvalMode?: string;
    requiredApprovals?: number;
    requiredApprovalRoles?: EnterpriseRole[];
    requiredApprovalClasses?: EnterpriseApprovalClass[];
    requiredApprovalJurisdictions?: string[];
    governancePackId?: string;
    governancePackVersion?: string;
    governancePackLabel?: string;
    governanceProfileId?: string;
    governanceProfileLabel?: string;
    governanceProfileRationale?: string[];
    approvalTrail?: Array<{
      identityId: string;
      role: EnterpriseRole;
      approvalClasses: EnterpriseApprovalClass[];
      matchedApprovalClasses: EnterpriseApprovalClass[];
      matchedApprovalJurisdictions: string[];
      action: 'approve';
      decidedAt: string;
    }>;
    effectiveFrom?: string;
    expiresAt?: string;
  };
  policyLifecycleContext?: {
    status: string;
    deprecatedAt?: string;
    deprecatedByIdentityId?: string | null;
    deprecationReason?: string | null;
    supersededByPolicyDefinitionId?: string | null;
    revokedAt?: string;
    revokedByIdentityId?: string | null;
    revocationReason?: string | null;
  };
  trustContext?: {
    organizationId: string;
    evaluatedIssuerCount: number;
    accreditedIssuerCount: number;
    enforced: boolean;
    anchors: PolicyTrustAnchorSnapshot[];
  };
  exceptionContext?: {
    active: boolean;
    count: number;
    exceptions: Array<{
      exceptionId: string;
      scope: string;
      subjectEntityId: string | null;
      policyVersion: string;
      justification: string;
      expiresAt?: string;
    }>;
  };
}

const POLICY_DEFINITIONS: Record<string, PolicyDefinition> = {
  sanctions_screening: {
    policyName: 'sanctions_screening',
    version: '2026.04.1',
    reference: 'zeroid://policy/screening/sanctions_screening@2026.04.1',
    family: 'screening',
  },
  batch_sanctions_screening: {
    policyName: 'batch_sanctions_screening',
    version: '2026.04.1',
    reference: 'zeroid://policy/screening/batch_sanctions_screening@2026.04.1',
    family: 'screening',
  },
  jurisdiction_compliance: {
    policyName: 'jurisdiction_compliance',
    version: '2026.04.1',
    reference: 'zeroid://policy/compliance/jurisdiction_compliance@2026.04.1',
    family: 'compliance',
  },
  regulatory_dashboard: {
    policyName: 'regulatory_dashboard',
    version: '2026.04.1',
    reference: 'zeroid://policy/reporting/regulatory_dashboard@2026.04.1',
    family: 'reporting',
  },
  regulatory_reporting: {
    policyName: 'regulatory_reporting',
    version: '2026.04.1',
    reference: 'zeroid://policy/reporting/regulatory_reporting@2026.04.1',
    family: 'reporting',
  },
  regulatory_submission: {
    policyName: 'regulatory_submission',
    version: '2026.04.1',
    reference: 'zeroid://policy/reporting/regulatory_submission@2026.04.1',
    family: 'reporting',
  },
  jurisdiction_cross_border: {
    policyName: 'jurisdiction_cross_border',
    version: '2026.04.1',
    reference: 'zeroid://policy/compliance/jurisdiction_cross_border@2026.04.1',
    family: 'compliance',
  },
  data_sovereignty_cross_border: {
    policyName: 'data_sovereignty_cross_border',
    version: '2026.04.1',
    reference: 'zeroid://policy/privacy/data_sovereignty_cross_border@2026.04.1',
    family: 'privacy',
  },
  data_subject_erasure: {
    policyName: 'data_subject_erasure',
    version: '2026.04.1',
    reference: 'zeroid://policy/privacy/data_subject_erasure@2026.04.1',
    family: 'privacy',
  },
  data_subject_access: {
    policyName: 'data_subject_access',
    version: '2026.04.1',
    reference: 'zeroid://policy/privacy/data_subject_access@2026.04.1',
    family: 'privacy',
  },
  privacy_impact_assessment: {
    policyName: 'privacy_impact_assessment',
    version: '2026.04.1',
    reference: 'zeroid://policy/privacy/privacy_impact_assessment@2026.04.1',
    family: 'privacy',
  },
  data_breach_notification: {
    policyName: 'data_breach_notification',
    version: '2026.04.1',
    reference: 'zeroid://policy/privacy/data_breach_notification@2026.04.1',
    family: 'privacy',
  },
};

export class PolicyContextService {
  async resolvePolicyContext(
    policyName: string,
    organizationId: string,
    options: {
      jurisdictionCodes?: string[];
      credentials?: CredentialTrustInput[];
      subjectEntityId?: string;
    } = {},
  ): Promise<PolicyExecutionContext> {
    const definition = await this.getPolicyDefinition(policyName, organizationId);
    const trustContext = await this.buildTrustContext(
      organizationId,
      options.credentials ?? [],
      options.jurisdictionCodes ?? [],
    );
    const exceptionContext = await this.buildExceptionContext(
      organizationId,
      definition.policyName,
      options.subjectEntityId,
    );

    return {
      policyName: definition.policyName,
      policyVersion: definition.version,
      policyDefinitionId: definition.id,
      policyReference: definition.reference,
      policyFamily: definition.family,
      ...(definition.id ? {
        policyApprovalContext: {
          approvedByIdentityId: definition.approvedByIdentityId ?? null,
          ...(definition.approvalMode ? { approvalMode: definition.approvalMode } : {}),
          ...(definition.requiredApprovals ? { requiredApprovals: definition.requiredApprovals } : {}),
          ...(definition.requiredApprovalRoles && definition.requiredApprovalRoles.length > 0 ? { requiredApprovalRoles: definition.requiredApprovalRoles } : {}),
          ...(definition.requiredApprovalClasses && definition.requiredApprovalClasses.length > 0 ? { requiredApprovalClasses: definition.requiredApprovalClasses } : {}),
          ...(definition.requiredApprovalJurisdictions && definition.requiredApprovalJurisdictions.length > 0 ? { requiredApprovalJurisdictions: definition.requiredApprovalJurisdictions } : {}),
          ...(definition.governancePackId ? { governancePackId: definition.governancePackId } : {}),
          ...(definition.governancePackVersion ? { governancePackVersion: definition.governancePackVersion } : {}),
          ...(definition.governancePackLabel ? { governancePackLabel: definition.governancePackLabel } : {}),
          ...(definition.governanceProfileId ? { governanceProfileId: definition.governanceProfileId } : {}),
          ...(definition.governanceProfileLabel ? { governanceProfileLabel: definition.governanceProfileLabel } : {}),
          ...(definition.governanceProfileRationale && definition.governanceProfileRationale.length > 0 ? { governanceProfileRationale: definition.governanceProfileRationale } : {}),
          ...(definition.approvalTrail && definition.approvalTrail.length > 0 ? { approvalTrail: definition.approvalTrail } : {}),
          ...(definition.effectiveFrom ? { effectiveFrom: definition.effectiveFrom } : {}),
          ...(definition.expiresAt ? { expiresAt: definition.expiresAt } : {}),
        },
      } : {}),
      ...(definition.id ? {
        policyLifecycleContext: {
          status: definition.lifecycleStatus ?? 'approved',
          ...(definition.deprecatedAt ? { deprecatedAt: definition.deprecatedAt } : {}),
          ...(definition.deprecatedByIdentityId !== undefined ? { deprecatedByIdentityId: definition.deprecatedByIdentityId ?? null } : {}),
          ...(definition.deprecationReason !== undefined ? { deprecationReason: definition.deprecationReason ?? null } : {}),
          ...(definition.supersededByPolicyDefinitionId !== undefined ? { supersededByPolicyDefinitionId: definition.supersededByPolicyDefinitionId ?? null } : {}),
          ...(definition.revokedAt ? { revokedAt: definition.revokedAt } : {}),
          ...(definition.revokedByIdentityId !== undefined ? { revokedByIdentityId: definition.revokedByIdentityId ?? null } : {}),
          ...(definition.revocationReason !== undefined ? { revocationReason: definition.revocationReason ?? null } : {}),
        },
      } : {}),
      ...(trustContext ? { trustContext } : {}),
      ...(exceptionContext ? { exceptionContext } : {}),
    };
  }

  private async getPolicyDefinition(
    policyName: string,
    organizationId: string,
  ): Promise<PolicyDefinition> {
    const policyModel = (prisma as any).policyDefinition;
    if (policyModel?.findFirst) {
      const now = new Date();
      const record = await policyModel.findFirst({
        where: {
          organizationId,
          name: policyName,
          status: 'APPROVED',
          OR: [
            { effectiveFrom: null },
            { effectiveFrom: { lte: now } },
          ],
          AND: [
            {
              OR: [
                { expiresAt: null },
                { expiresAt: { gt: now } },
              ],
            },
          ],
        },
        orderBy: [
          { effectiveFrom: 'desc' },
          { updatedAt: 'desc' },
        ],
      });

      if (record) {
        return {
          id: record.id,
          policyName: record.name,
          version: record.version,
          reference: record.reference,
          family: this.toPolicyFamily(record.family),
          approvedByIdentityId: record.approvedByIdentityId ?? null,
          approvalMode: String(record.approvalMode ?? 'single_admin').toLowerCase(),
          requiredApprovals: typeof record.requiredApprovals === 'number' ? record.requiredApprovals : undefined,
          requiredApprovalRoles: this.normalizeRequiredApprovalRoles(record.requiredApprovalRoles),
          requiredApprovalClasses: this.normalizeRequiredApprovalClasses(record.requiredApprovalClasses),
          requiredApprovalJurisdictions: this.normalizeRequiredApprovalJurisdictions(record.requiredApprovalJurisdictions),
          governancePackId: record.governancePackId ?? undefined,
          governancePackVersion: record.governancePackVersion ?? undefined,
          governancePackLabel: record.governancePackLabel ?? undefined,
          governanceProfileId: record.governanceProfileId ?? undefined,
          governanceProfileLabel: record.governanceProfileLabel ?? undefined,
          governanceProfileRationale: this.normalizeGovernanceRationale(record.governanceProfileRationale),
          approvalTrail: this.normalizeApprovalTrail(record.approvalTrail),
          effectiveFrom: record.effectiveFrom ? new Date(record.effectiveFrom).toISOString() : undefined,
          expiresAt: record.expiresAt ? new Date(record.expiresAt).toISOString() : undefined,
          lifecycleStatus: String(record.status ?? 'APPROVED').toLowerCase(),
          deprecatedAt: record.deprecatedAt ? new Date(record.deprecatedAt).toISOString() : undefined,
          deprecatedByIdentityId: record.deprecatedByIdentityId ?? undefined,
          deprecationReason: record.deprecationReason ?? undefined,
          supersededByPolicyDefinitionId: record.supersededByPolicyDefinitionId ?? undefined,
          revokedAt: record.revokedAt ? new Date(record.revokedAt).toISOString() : undefined,
          revokedByIdentityId: record.revokedByIdentityId ?? undefined,
          revocationReason: record.revocationReason ?? undefined,
        };
      }
    }

    const staticDefinition = POLICY_DEFINITIONS[policyName];
    if (staticDefinition) {
      return staticDefinition;
    }

    throw new PolicyContextError(
      `No approved policy definition exists for ${policyName}`,
      'POLICY_DEFINITION_NOT_FOUND',
    );
  }

  private normalizeRequiredApprovalRoles(value: unknown): EnterpriseRole[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => String(entry))
      .filter((entry): entry is EnterpriseRole => ['viewer', 'operator', 'admin', 'compliance_officer', 'auditor'].includes(entry));
  }

  private normalizeRequiredApprovalClasses(value: unknown): EnterpriseApprovalClass[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => String(entry))
      .filter((entry): entry is EnterpriseApprovalClass =>
        ['admin', 'auditor', 'compliance', 'legal', 'operator', 'privacy', 'risk', 'sovereign_operator'].includes(entry),
      );
  }

  private normalizeRequiredApprovalJurisdictions(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => String(entry))
      .filter((entry) => entry.length > 0);
  }

  private normalizeApprovalTrail(value: unknown): Array<{
    identityId: string;
    role: EnterpriseRole;
    approvalClasses: EnterpriseApprovalClass[];
    matchedApprovalClasses: EnterpriseApprovalClass[];
    matchedApprovalJurisdictions: string[];
    action: 'approve';
    decidedAt: string;
  }> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry: any) => ({
        identityId: String(entry.identityId),
        role: ['viewer', 'operator', 'admin', 'compliance_officer', 'auditor'].includes(String(entry.role))
          ? String(entry.role) as EnterpriseRole
          : 'admin',
        approvalClasses: this.normalizeRequiredApprovalClasses(entry.approvalClasses),
        matchedApprovalClasses: this.normalizeRequiredApprovalClasses(entry.matchedApprovalClasses),
        matchedApprovalJurisdictions: this.normalizeRequiredApprovalJurisdictions(entry.matchedApprovalJurisdictions),
        action: 'approve' as const,
        decidedAt: String(entry.decidedAt),
      }))
      .filter((entry) => entry.identityId.length > 0 && entry.decidedAt.length > 0);
  }

  private async buildTrustContext(
    organizationId: string,
    credentials: CredentialTrustInput[],
    jurisdictionCodes: string[],
  ): Promise<PolicyExecutionContext['trustContext'] | undefined> {
    const normalized = this.normalizeCredentialInputs(credentials);
    if (normalized.length === 0) {
      return undefined;
    }

    const trustModel = (prisma as any).issuerTrustRecord;
    if (!trustModel?.findMany) {
      return {
        organizationId,
        evaluatedIssuerCount: normalized.length,
        accreditedIssuerCount: 0,
        enforced: false,
        anchors: normalized.map((entry) => ({
          issuerIdentityId: entry.issuerId,
          issuerDid: '',
          issuerDisplayName: null,
          status: 'untracked',
          accepted: true,
          evaluatedCredentialTypes: entry.credentialTypes,
          matchedJurisdictions: [],
        })),
      };
    }

    const records = await trustModel.findMany({
      where: {
        organizationId,
        issuerIdentityId: {
          in: normalized.map((entry) => entry.issuerId),
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
    });

    const now = new Date();
    const anchors = normalized.map((entry) => {
      const issuerRecords = records.filter((record: any) => record.issuerIdentityId === entry.issuerId);
      const activeRecord = issuerRecords.find((record: any) => (
        record.status === 'ACCREDITED' &&
        (!record.expiresAt || new Date(record.expiresAt) > now)
      ));

      if (!activeRecord) {
        return {
          issuerIdentityId: entry.issuerId,
          issuerDid: issuerRecords[0]?.issuerDid ?? '',
          issuerDisplayName: issuerRecords[0]?.issuer?.displayName ?? null,
          status: issuerRecords[0] ? String(issuerRecords[0].status).toLowerCase() : 'untracked',
          accepted: issuerRecords.length === 0,
          evaluatedCredentialTypes: entry.credentialTypes,
          matchedJurisdictions: [],
        };
      }

      const matchedJurisdictions = this.intersectJurisdictions(
        jurisdictionCodes,
        activeRecord.allowedJurisdictions ?? [],
      );
      const credentialTypeAllowed = entry.credentialTypes.some((credentialType) =>
        Array.isArray(activeRecord.allowedCredentialTypes)
          && activeRecord.allowedCredentialTypes.includes(credentialType),
      );
      const jurisdictionAllowed = matchedJurisdictions.length > 0
        || !Array.isArray(activeRecord.allowedJurisdictions)
        || activeRecord.allowedJurisdictions.length === 0
        || jurisdictionCodes.length === 0;

      return {
        issuerIdentityId: entry.issuerId,
        issuerDid: activeRecord.issuerDid,
        issuerDisplayName: activeRecord.issuer?.displayName ?? null,
        trustRecordId: activeRecord.id,
        status: String(activeRecord.status).toLowerCase(),
        accreditationScope: String(activeRecord.accreditationScope ?? 'ENTERPRISE').toLowerCase(),
        assuranceLevel: String(activeRecord.assuranceLevel ?? 'STANDARD').toLowerCase(),
        accepted: credentialTypeAllowed && jurisdictionAllowed,
        evaluatedCredentialTypes: entry.credentialTypes,
        matchedJurisdictions,
        expiresAt: activeRecord.expiresAt ? new Date(activeRecord.expiresAt).toISOString() : undefined,
      };
    });

    return {
      organizationId,
      evaluatedIssuerCount: anchors.length,
      accreditedIssuerCount: anchors.filter((anchor) => Boolean(anchor.trustRecordId)).length,
      enforced: records.length > 0,
      anchors,
    };
  }

  private normalizeCredentialInputs(credentials: CredentialTrustInput[]): Array<{
    issuerId: string;
    credentialTypes: string[];
  }> {
    const merged = new Map<string, Set<string>>();
    for (const credential of credentials) {
      if (!credential.issuerId) continue;
      const entry = merged.get(credential.issuerId) ?? new Set<string>();
      if (credential.credentialType) {
        entry.add(credential.credentialType);
      }
      merged.set(credential.issuerId, entry);
    }

    return Array.from(merged.entries()).map(([issuerId, credentialTypes]) => ({
      issuerId,
      credentialTypes: Array.from(credentialTypes),
    }));
  }

  private intersectJurisdictions(
    requestedJurisdictions: string[],
    allowedJurisdictions: string[],
  ): string[] {
    if (requestedJurisdictions.length === 0 || allowedJurisdictions.length === 0) {
      return [];
    }

    const allowed = new Set(allowedJurisdictions);
    return requestedJurisdictions.filter((jurisdiction) => allowed.has(jurisdiction));
  }

  private toPolicyFamily(value: string): PolicyDefinition['family'] {
    if (['compliance', 'reporting', 'privacy', 'screening'].includes(value)) {
      return value as PolicyDefinition['family'];
    }
    return 'compliance';
  }

  private async buildExceptionContext(
    organizationId: string,
    policyName: string,
    subjectEntityId?: string,
  ): Promise<PolicyExecutionContext['exceptionContext'] | undefined> {
    const exceptionModel = (prisma as any).policyException;
    if (!exceptionModel?.findMany) {
      return undefined;
    }

    const now = new Date();
    const records = await exceptionModel.findMany({
      where: {
        organizationId,
        policyName,
        status: 'APPROVED',
        ...(subjectEntityId ? {
          OR: [
            { subjectEntityId },
            { subjectEntityId: null },
          ],
        } : {}),
        OR: [
          { effectiveFrom: null },
          { effectiveFrom: { lte: now } },
        ],
        AND: [
          {
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: now } },
            ],
          },
        ],
      },
      orderBy: [
        { effectiveFrom: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    if (!records.length) {
      return undefined;
    }

    return {
      active: true,
      count: records.length,
      exceptions: records.map((record: any) => ({
        exceptionId: record.id,
        scope: String(record.scope ?? 'SUBJECT').toLowerCase(),
        subjectEntityId: record.subjectEntityId ?? null,
        policyVersion: record.policyVersion,
        justification: record.justification,
        expiresAt: record.expiresAt ? new Date(record.expiresAt).toISOString() : undefined,
      })),
    };
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

export const policyContextService = new PolicyContextService();
