import { z } from 'zod';
import { prisma } from '../../index';
import {
  ENTERPRISE_APPROVAL_CLASSES,
  ENTERPRISE_ROLES,
  type EnterpriseApprovalClass,
  type EnterpriseRole,
  enterpriseOrganizationService,
} from './organization-service';
import { policyGovernanceService } from './policy-governance-service';

export const POLICY_DEFINITION_STATUSES = [
  'draft',
  'pending_review',
  'approved',
  'deprecated',
  'revoked',
] as const;

export type PolicyDefinitionStatus = typeof POLICY_DEFINITION_STATUSES[number];

export const POLICY_APPROVAL_MODES = [
  'single_admin',
  'separation_of_duties',
  'dual_control',
] as const;

export type PolicyApprovalMode = typeof POLICY_APPROVAL_MODES[number];

export const CreatePolicyDefinitionSchema = z.object({
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(64),
  family: z.enum(['compliance', 'reporting', 'privacy', 'screening']),
  description: z.string().min(10).max(500),
  definition: z.record(z.unknown()),
  changeSummary: z.string().min(5).max(500).optional(),
  approvalMode: z.enum(POLICY_APPROVAL_MODES).default('single_admin'),
  requiredApprovals: z.number().int().min(1).max(5).optional(),
  requiredApprovalRoles: z.array(z.enum(ENTERPRISE_ROLES)).max(5).optional(),
  requiredApprovalClasses: z.array(z.enum(ENTERPRISE_APPROVAL_CLASSES)).max(8).optional(),
  requiredApprovalJurisdictions: z.array(z.string().min(2).max(32)).max(16).optional(),
  effectiveFrom: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
});

export type CreatePolicyDefinitionInput = z.infer<typeof CreatePolicyDefinitionSchema>;

export const ListPolicyDefinitionsSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  status: z.enum(POLICY_DEFINITION_STATUSES).optional(),
});

export type ListPolicyDefinitionsInput = z.infer<typeof ListPolicyDefinitionsSchema>;

export const DeprecatePolicyDefinitionSchema = z.object({
  reason: z.string().min(10).max(500).optional(),
  supersededByPolicyId: z.string().min(1).max(255).optional(),
  deprecatedAt: z.string().datetime().optional(),
});

export type DeprecatePolicyDefinitionInput = z.infer<typeof DeprecatePolicyDefinitionSchema>;

export const RevokePolicyDefinitionSchema = z.object({
  reason: z.string().min(10).max(500).optional(),
  revokedAt: z.string().datetime().optional(),
});

export type RevokePolicyDefinitionInput = z.infer<typeof RevokePolicyDefinitionSchema>;

export interface PolicyApprovalTrailEntry {
  identityId: string;
  role: EnterpriseRole;
  approvalClasses: EnterpriseApprovalClass[];
  matchedApprovalClasses: EnterpriseApprovalClass[];
  matchedApprovalJurisdictions: string[];
  action: 'approve';
  decidedAt: string;
}

export interface PolicyDefinitionSummary {
  id: string;
  organizationId: string;
  name: string;
  version: string;
  family: string;
  reference: string;
  description: string;
  status: PolicyDefinitionStatus;
  approvalMode: PolicyApprovalMode;
  requiredApprovals: number;
  requiredApprovalRoles: EnterpriseRole[];
  requiredApprovalClasses: EnterpriseApprovalClass[];
  requiredApprovalJurisdictions: string[];
  governanceProfileId: string | null;
  governanceProfileLabel: string | null;
  governancePackId: string | null;
  governancePackVersion: string | null;
  governancePackLabel: string | null;
  governanceProfileRationale: string[];
  approvalCount: number;
  approvalTrail: PolicyApprovalTrailEntry[];
  definition: Record<string, unknown>;
  changeSummary: string | null;
  proposedByIdentityId: string;
  approvedByIdentityId: string | null;
  effectiveFrom: Date | null;
  expiresAt: Date | null;
  deprecatedAt: Date | null;
  deprecatedByIdentityId: string | null;
  deprecationReason: string | null;
  supersededByPolicyDefinitionId: string | null;
  revokedAt: Date | null;
  revokedByIdentityId: string | null;
  revocationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class PolicyRegistryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'PolicyRegistryError';
  }
}

export class PolicyRegistryService {
  async createPolicyDraft(
    organizationId: string,
    proposedByIdentityId: string,
    input: CreatePolicyDefinitionInput,
  ): Promise<PolicyDefinitionSummary> {
    const parsed = CreatePolicyDefinitionSchema.parse(input);
    const governanceContext = await enterpriseOrganizationService.getApprovalAuthority(
      proposedByIdentityId,
      organizationId,
    );
    const governanceProfile = policyGovernanceService.applyGovernanceBaseline({
      organizationPlan: governanceContext.plan,
      organizationJurisdictions: governanceContext.jurisdictions,
      organizationGovernanceSettings: governanceContext.governanceSettings,
      policyName: parsed.name,
      family: parsed.family,
      approvalMode: parsed.approvalMode,
      requiredApprovals: parsed.requiredApprovals,
      requiredApprovalRoles: parsed.requiredApprovalRoles,
      requiredApprovalClasses: parsed.requiredApprovalClasses,
      requiredApprovalJurisdictions: parsed.requiredApprovalJurisdictions,
    });
    this.assertDefinitionCompatibleWithGovernancePack(
      parsed.family,
      governanceProfile.governancePackId,
      parsed.definition,
    );
    const approvalConfig = this.normalizeApprovalConfiguration(
      governanceProfile.approvalMode,
      governanceProfile.requiredApprovals,
      governanceProfile.requiredApprovalRoles,
      governanceProfile.requiredApprovalClasses,
      governanceProfile.requiredApprovalJurisdictions,
    );
    const model = this.getPolicyModel();

    const existing = await model.findUnique({
      where: {
        organizationId_name_version: {
          organizationId,
          name: parsed.name,
          version: parsed.version,
        },
      },
    });
    if (existing) {
      throw new PolicyRegistryError(
        'Policy version already exists for this organization',
        'POLICY_VERSION_DUPLICATE',
        409,
      );
    }

    const record = await model.create({
      data: {
        organizationId,
        name: parsed.name,
        version: parsed.version,
        family: parsed.family,
        reference: this.buildPolicyReference(organizationId, parsed.name, parsed.version),
        description: parsed.description,
        status: 'DRAFT',
        approvalMode: approvalConfig.approvalMode.toUpperCase(),
        requiredApprovals: approvalConfig.requiredApprovals,
        requiredApprovalRoles: approvalConfig.requiredApprovalRoles,
        requiredApprovalClasses: approvalConfig.requiredApprovalClasses,
        requiredApprovalJurisdictions: approvalConfig.requiredApprovalJurisdictions,
        governanceProfileId: governanceProfile.governanceProfileId,
        governanceProfileLabel: governanceProfile.governanceProfileLabel,
        governancePackId: governanceProfile.governancePackId,
        governancePackVersion: governanceProfile.governancePackVersion,
        governancePackLabel: governanceProfile.governancePackLabel,
        governanceProfileRationale: governanceProfile.governanceRationale,
        approvalTrail: [],
        definition: parsed.definition,
        changeSummary: parsed.changeSummary,
        proposedByIdentityId,
        effectiveFrom: parsed.effectiveFrom ? new Date(parsed.effectiveFrom) : null,
        expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
      },
    });

    await prisma.auditLog.create({
      data: {
        identityId: proposedByIdentityId,
        action: 'SCHEMA_PROPOSED',
        resourceType: 'policy_definition',
        resourceId: record.id,
        details: {
          organizationId,
          name: parsed.name,
          version: parsed.version,
          status: 'DRAFT',
          family: parsed.family,
          governanceProfileId: governanceProfile.governanceProfileId,
          governanceProfileLabel: governanceProfile.governanceProfileLabel,
          governanceProfileRationale: governanceProfile.governanceRationale,
        },
      },
    });

    return this.formatPolicy(record);
  }

  async listPolicies(
    organizationId: string,
    input: ListPolicyDefinitionsInput = {},
  ): Promise<PolicyDefinitionSummary[]> {
    const parsed = ListPolicyDefinitionsSchema.parse(input);
    const model = this.getPolicyModel();

    const records = await model.findMany({
      where: {
        organizationId,
        ...(parsed.name ? { name: parsed.name } : {}),
        ...(parsed.status ? { status: parsed.status.toUpperCase() } : {}),
      },
      orderBy: [
        { name: 'asc' },
        { createdAt: 'desc' },
      ],
    });

    return records.map((record: any) => this.formatPolicy(record));
  }

  async submitPolicyForReview(
    policyId: string,
    organizationId: string,
    actorIdentityId: string,
  ): Promise<PolicyDefinitionSummary> {
    const model = this.getPolicyModel();
    const record = await this.getPolicy(policyId, organizationId);
    const actorAuthority = await enterpriseOrganizationService.getApprovalAuthority(actorIdentityId, organizationId);

    if (record.status !== 'DRAFT') {
      throw new PolicyRegistryError(
        'Only draft policies can be submitted for review',
        'POLICY_SUBMIT_INVALID_STATE',
        409,
      );
    }

    this.assertDraftMatchesTenantGovernance(record, actorAuthority);

    const updated = await model.update({
      where: { id: policyId },
      data: {
        status: 'PENDING_REVIEW',
      },
    });

    await prisma.auditLog.create({
      data: {
        identityId: actorIdentityId,
        action: 'SCHEMA_PROPOSED',
        resourceType: 'policy_definition',
        resourceId: policyId,
        previousState: { status: record.status },
        newState: { status: 'PENDING_REVIEW' },
        details: {
          organizationId,
          name: record.name,
          version: record.version,
        },
      },
    });

    return this.formatPolicy(updated);
  }

  async approvePolicy(
    policyId: string,
    organizationId: string,
    actorIdentityId: string,
    effectiveFrom?: string,
  ): Promise<PolicyDefinitionSummary> {
    const model = this.getPolicyModel();
    const record = await this.getPolicy(policyId, organizationId);
    const actorAuthority = await enterpriseOrganizationService.getApprovalAuthority(actorIdentityId, organizationId);
    const actorRole = actorAuthority.role;

    if (!['DRAFT', 'PENDING_REVIEW'].includes(record.status)) {
      throw new PolicyRegistryError(
        'Only draft or pending-review policies can be approved',
        'POLICY_APPROVE_INVALID_STATE',
        409,
      );
    }

    this.assertDraftMatchesTenantGovernance(record, actorAuthority);

    const approvalMode = this.normalizeApprovalMode(record.approvalMode);
    const requiredApprovalRoles = this.normalizeRequiredApprovalRoles(record.requiredApprovalRoles);
    const requiredApprovalClasses = this.normalizeRequiredApprovalClasses(record.requiredApprovalClasses);
    const requiredApprovalJurisdictions = this.normalizeRequiredApprovalJurisdictions(record.requiredApprovalJurisdictions);
    if (approvalMode !== 'single_admin' && record.proposedByIdentityId === actorIdentityId) {
      throw new PolicyRegistryError(
        'Policy approval requires separation of duties',
        'POLICY_APPROVE_SOD_REQUIRED',
        409,
      );
    }

    if (requiredApprovalRoles.length > 0 && !requiredApprovalRoles.includes(actorRole)) {
      throw new PolicyRegistryError(
        `Policy approval requires one of these enterprise roles: ${requiredApprovalRoles.join(', ')}`,
        'POLICY_APPROVE_ROLE_NOT_ALLOWED',
        403,
      );
    }

    const matchedApprovalClasses = requiredApprovalClasses.filter((approvalClass) =>
      actorAuthority.approvalClasses.includes(approvalClass),
    );
    if (requiredApprovalClasses.length > 0 && matchedApprovalClasses.length === 0) {
      throw new PolicyRegistryError(
        `Policy approval requires one of these approval classes: ${requiredApprovalClasses.join(', ')}`,
        'POLICY_APPROVE_CLASS_NOT_ALLOWED',
        403,
      );
    }

    const matchedApprovalJurisdictions = requiredApprovalJurisdictions.filter((jurisdiction) =>
      actorAuthority.approvalJurisdictions.includes(jurisdiction),
    );
    if (requiredApprovalJurisdictions.length > 0 && matchedApprovalJurisdictions.length === 0) {
      throw new PolicyRegistryError(
        `Policy approval requires delegated jurisdiction authority for one of: ${requiredApprovalJurisdictions.join(', ')}`,
        'POLICY_APPROVE_JURISDICTION_NOT_ALLOWED',
        403,
      );
    }

    const approvalTrail = this.normalizeApprovalTrail(record.approvalTrail);
    if (approvalTrail.some((entry) => entry.identityId === actorIdentityId)) {
      throw new PolicyRegistryError(
        'This approver has already recorded an approval for the policy',
        'POLICY_APPROVE_DUPLICATE',
        409,
      );
    }
    if (
      requiredApprovalRoles.length > 1
      && requiredApprovalRoles.includes(actorRole)
      && approvalTrail.some((entry) => entry.role === actorRole)
    ) {
      throw new PolicyRegistryError(
        `Policy approval role ${actorRole} has already been satisfied`,
        'POLICY_APPROVE_ROLE_DUPLICATE',
        409,
      );
    }
    const unsatisfiedApprovalClasses = matchedApprovalClasses.filter((approvalClass) =>
      !approvalTrail.some((entry) => entry.matchedApprovalClasses.includes(approvalClass)),
    );
    if (
      requiredApprovalClasses.length > 1
      && matchedApprovalClasses.length > 0
      && unsatisfiedApprovalClasses.length === 0
    ) {
      throw new PolicyRegistryError(
        'Policy approval classes already satisfied by prior approvals',
        'POLICY_APPROVE_CLASS_DUPLICATE',
        409,
      );
    }
    const unsatisfiedApprovalJurisdictions = matchedApprovalJurisdictions.filter((jurisdiction) =>
      !approvalTrail.some((entry) => entry.matchedApprovalJurisdictions.includes(jurisdiction)),
    );
    if (
      requiredApprovalJurisdictions.length > 1
      && matchedApprovalJurisdictions.length > 0
      && unsatisfiedApprovalJurisdictions.length === 0
    ) {
      throw new PolicyRegistryError(
        'Policy approval jurisdictions already satisfied by prior approvals',
        'POLICY_APPROVE_JURISDICTION_DUPLICATE',
        409,
      );
    }

    const effectiveAt = effectiveFrom ? new Date(effectiveFrom) : record.effectiveFrom ?? new Date();
    const nextApprovalTrail = [
      ...approvalTrail,
      {
        identityId: actorIdentityId,
        role: actorRole,
        approvalClasses: actorAuthority.approvalClasses,
        matchedApprovalClasses,
        matchedApprovalJurisdictions,
        action: 'approve' as const,
        decidedAt: new Date().toISOString(),
      },
    ];
    const requiredApprovals = this.normalizeRequiredApprovals(
      record.requiredApprovals,
      approvalMode,
      requiredApprovalRoles,
      requiredApprovalClasses,
      requiredApprovalJurisdictions,
    );
    const fullyApproved = nextApprovalTrail.length >= requiredApprovals
      && this.isRoleQuorumSatisfied(nextApprovalTrail, requiredApprovalRoles)
      && this.isClassQuorumSatisfied(nextApprovalTrail, requiredApprovalClasses)
      && this.isJurisdictionQuorumSatisfied(nextApprovalTrail, requiredApprovalJurisdictions);
    const updated = await model.update({
      where: { id: policyId },
      data: {
        status: fullyApproved ? 'APPROVED' : 'PENDING_REVIEW',
        approvedByIdentityId: fullyApproved ? actorIdentityId : null,
        effectiveFrom: fullyApproved ? effectiveAt : record.effectiveFrom ?? null,
        requiredApprovalRoles,
        requiredApprovalClasses,
        requiredApprovalJurisdictions,
        approvalTrail: nextApprovalTrail,
      },
    });

    await prisma.auditLog.create({
      data: {
        identityId: actorIdentityId,
        action: 'SCHEMA_APPROVED',
        resourceType: 'policy_definition',
        resourceId: policyId,
        previousState: { status: record.status },
        newState: {
          status: fullyApproved ? 'APPROVED' : 'PENDING_REVIEW',
          effectiveFrom: fullyApproved ? effectiveAt.toISOString() : null,
          approvalCount: nextApprovalTrail.length,
          requiredApprovals,
          requiredApprovalRoles,
          requiredApprovalClasses,
          requiredApprovalJurisdictions,
        },
        details: {
          organizationId,
          name: record.name,
          version: record.version,
          approvalMode,
          actorRole,
          actorApprovalClasses: actorAuthority.approvalClasses,
          actorApprovalJurisdictions: actorAuthority.approvalJurisdictions,
          approvalCount: nextApprovalTrail.length,
          requiredApprovals,
          requiredApprovalRoles,
          requiredApprovalClasses,
          requiredApprovalJurisdictions,
        },
      },
    });

    return this.formatPolicy(updated);
  }

  async deprecatePolicy(
    policyId: string,
    organizationId: string,
    actorIdentityId: string,
    input: DeprecatePolicyDefinitionInput = {},
  ): Promise<PolicyDefinitionSummary> {
    const parsed = DeprecatePolicyDefinitionSchema.parse(input);
    const model = this.getPolicyModel();
    const record = await this.getPolicy(policyId, organizationId);

    if (record.status !== 'APPROVED') {
      throw new PolicyRegistryError(
        'Only approved policies can be deprecated',
        'POLICY_DEPRECATE_INVALID_STATE',
        409,
      );
    }

    if (parsed.supersededByPolicyId) {
      const superseding = await this.getPolicy(parsed.supersededByPolicyId, organizationId);
      if (superseding.id === record.id) {
        throw new PolicyRegistryError(
          'A policy cannot supersede itself',
          'POLICY_SUPERSEDE_SELF',
          409,
        );
      }
    }

    const deprecatedAt = parsed.deprecatedAt ? new Date(parsed.deprecatedAt) : new Date();
    const updated = await model.update({
      where: { id: policyId },
      data: {
        status: 'DEPRECATED',
        deprecatedAt,
        deprecatedByIdentityId: actorIdentityId,
        deprecationReason: parsed.reason ?? 'Deprecated by enterprise policy administrator',
        supersededByPolicyDefinitionId: parsed.supersededByPolicyId ?? null,
      },
    });

    await prisma.auditLog.create({
      data: {
        identityId: actorIdentityId,
        action: 'SCHEMA_REVOKED',
        resourceType: 'policy_definition',
        resourceId: policyId,
        previousState: { status: record.status },
        newState: {
          status: 'DEPRECATED',
          deprecatedAt: deprecatedAt.toISOString(),
          supersededByPolicyDefinitionId: parsed.supersededByPolicyId ?? null,
        },
        details: {
          organizationId,
          name: record.name,
          version: record.version,
          reason: parsed.reason ?? 'Deprecated by enterprise policy administrator',
        },
      },
    });

    return this.formatPolicy(updated);
  }

  async revokePolicy(
    policyId: string,
    organizationId: string,
    actorIdentityId: string,
    input: RevokePolicyDefinitionInput = {},
  ): Promise<PolicyDefinitionSummary> {
    const parsed = RevokePolicyDefinitionSchema.parse(input);
    const model = this.getPolicyModel();
    const record = await this.getPolicy(policyId, organizationId);

    if (!['APPROVED', 'DEPRECATED'].includes(record.status)) {
      throw new PolicyRegistryError(
        'Only approved or deprecated policies can be revoked',
        'POLICY_REVOKE_INVALID_STATE',
        409,
      );
    }

    const revokedAt = parsed.revokedAt ? new Date(parsed.revokedAt) : new Date();
    const updated = await model.update({
      where: { id: policyId },
      data: {
        status: 'REVOKED',
        revokedAt,
        revokedByIdentityId: actorIdentityId,
        revocationReason: parsed.reason ?? 'Revoked by enterprise policy administrator',
      },
    });

    await prisma.auditLog.create({
      data: {
        identityId: actorIdentityId,
        action: 'SCHEMA_REVOKED',
        resourceType: 'policy_definition',
        resourceId: policyId,
        previousState: { status: record.status },
        newState: {
          status: 'REVOKED',
          revokedAt: revokedAt.toISOString(),
        },
        details: {
          organizationId,
          name: record.name,
          version: record.version,
          reason: parsed.reason ?? 'Revoked by enterprise policy administrator',
        },
      },
    });

    return this.formatPolicy(updated);
  }

  async getEffectivePolicy(
    organizationId: string,
    name: string,
  ): Promise<PolicyDefinitionSummary | null> {
    const model = this.getPolicyModel();
    const now = new Date();
    const record = await model.findFirst({
      where: {
        organizationId,
        name,
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

    return record ? this.formatPolicy(record) : null;
  }

  private async getPolicy(policyId: string, organizationId: string): Promise<any> {
    const model = this.getPolicyModel();
    const record = await model.findFirst({
      where: {
        id: policyId,
        organizationId,
      },
    });

    if (!record) {
      throw new PolicyRegistryError(
        'Policy definition not found',
        'POLICY_NOT_FOUND',
        404,
      );
    }

    return record;
  }

  private getPolicyModel(): any {
    const model = (prisma as any).policyDefinition;
    if (!model) {
      throw new PolicyRegistryError(
        'Policy definition model is not available in this runtime',
        'POLICY_MODEL_UNAVAILABLE',
        500,
      );
    }
    return model;
  }

  private buildPolicyReference(
    organizationId: string,
    name: string,
    version: string,
  ): string {
    return `zeroid://policy/org/${organizationId}/${name}@${version}`;
  }

  private assertDraftMatchesTenantGovernance(
    record: any,
    actorAuthority: Awaited<ReturnType<typeof enterpriseOrganizationService.getApprovalAuthority>>,
  ): void {
    const hasRecordedGovernance = Boolean(
      record.governancePackId
      || record.governancePackVersion
      || record.governanceProfileId,
    );
    if (!hasRecordedGovernance) {
      return;
    }

    const expectedGovernance = policyGovernanceService.applyGovernanceBaseline({
      organizationPlan: actorAuthority.plan,
      organizationJurisdictions: actorAuthority.jurisdictions,
      organizationGovernanceSettings: actorAuthority.governanceSettings,
      policyName: record.name,
      family: String(record.family ?? 'compliance').toLowerCase() as CreatePolicyDefinitionInput['family'],
      approvalMode: this.normalizeApprovalMode(record.approvalMode),
      requiredApprovals: typeof record.requiredApprovals === 'number' ? record.requiredApprovals : undefined,
      requiredApprovalRoles: this.normalizeRequiredApprovalRoles(record.requiredApprovalRoles),
      requiredApprovalClasses: this.normalizeRequiredApprovalClasses(record.requiredApprovalClasses),
      requiredApprovalJurisdictions: this.normalizeRequiredApprovalJurisdictions(record.requiredApprovalJurisdictions),
    });

    const expectedConfig = this.normalizeApprovalConfiguration(
      expectedGovernance.approvalMode,
      expectedGovernance.requiredApprovals,
      expectedGovernance.requiredApprovalRoles,
      expectedGovernance.requiredApprovalClasses,
      expectedGovernance.requiredApprovalJurisdictions,
    );

    this.assertDefinitionCompatibleWithGovernancePack(
      String(record.family ?? 'compliance').toLowerCase() as CreatePolicyDefinitionInput['family'],
      expectedGovernance.governancePackId,
      (record.definition ?? {}) as Record<string, unknown>,
    );

    const governanceChanged =
      (record.governancePackId ?? null) !== expectedGovernance.governancePackId
      || (record.governancePackVersion ?? null) !== expectedGovernance.governancePackVersion
      || this.normalizeApprovalMode(record.approvalMode) !== expectedConfig.approvalMode
      || this.normalizeRequiredApprovals(
        record.requiredApprovals,
        this.normalizeApprovalMode(record.approvalMode),
        this.normalizeRequiredApprovalRoles(record.requiredApprovalRoles),
        this.normalizeRequiredApprovalClasses(record.requiredApprovalClasses),
        this.normalizeRequiredApprovalJurisdictions(record.requiredApprovalJurisdictions),
      ) !== expectedConfig.requiredApprovals
      || !this.sameSet(
        this.normalizeRequiredApprovalRoles(record.requiredApprovalRoles),
        expectedConfig.requiredApprovalRoles,
      )
      || !this.sameSet(
        this.normalizeRequiredApprovalClasses(record.requiredApprovalClasses),
        expectedConfig.requiredApprovalClasses,
      )
      || !this.sameSet(
        this.normalizeRequiredApprovalJurisdictions(record.requiredApprovalJurisdictions),
        expectedConfig.requiredApprovalJurisdictions,
      );

    if (governanceChanged) {
      throw new PolicyRegistryError(
        'Policy draft no longer matches the active tenant governance regime. Refresh the draft under current governance before review or approval.',
        'POLICY_GOVERNANCE_STALE',
        409,
      );
    }
  }

  private assertDefinitionCompatibleWithGovernancePack(
    family: CreatePolicyDefinitionInput['family'],
    governancePackId: string,
    definition: Record<string, unknown>,
  ): void {
    const definitionKeys = new Set(Object.keys(definition ?? {}));
    const hasAnyKey = (keys: string[]) => keys.some((key) => definitionKeys.has(key));

    const validationRules: Partial<Record<string, { families?: CreatePolicyDefinitionInput['family'][]; requiredKeys: string[]; message: string }>> = {
      'enterprise-privacy': {
        families: ['privacy'],
        requiredKeys: ['privacyRights', 'retentionPolicy', 'lawfulBasis', 'dataCategories', 'dsarWorkflow', 'reviewCadence'],
        message: 'Enterprise privacy governance requires definition fields like privacyRights, retentionPolicy, lawfulBasis, or dsarWorkflow.',
      },
      'enterprise-screening': {
        families: ['screening'],
        requiredKeys: ['screeningRules', 'watchlists', 'escalationPolicy', 'matchThreshold', 'falsePositiveWorkflow'],
        message: 'Enterprise screening governance requires definition fields like screeningRules, watchlists, escalationPolicy, or matchThreshold.',
      },
      'enterprise-reporting': {
        families: ['reporting'],
        requiredKeys: ['reportType', 'reportingChannels', 'filingRules', 'reportSchema', 'submissionCadence'],
        message: 'Enterprise reporting governance requires definition fields like reportType, reportSchema, filingRules, or submissionCadence.',
      },
      'cross-border-regulated': {
        requiredKeys: ['transferRules', 'transferMechanisms', 'dataLocalization', 'jurisdictionMatrix', 'recipientControls'],
        message: 'Cross-border governance requires definition fields like transferRules, transferMechanisms, dataLocalization, or jurisdictionMatrix.',
      },
      'sovereign-core': {
        requiredKeys: ['sovereignBoundaries', 'nationalHosting', 'issuerTrustRequirements', 'sovereignApprovalChain', 'regulatorAuthority'],
        message: 'Sovereign governance requires definition fields like sovereignBoundaries, nationalHosting, issuerTrustRequirements, or regulatorAuthority.',
      },
    };

    const rule = validationRules[governancePackId];
    if (!rule) {
      return;
    }

    if (rule.families && !rule.families.includes(family)) {
      throw new PolicyRegistryError(
        `${governancePackId} is not compatible with ${family} policies.`,
        'POLICY_GOVERNANCE_DEFINITION_INVALID',
        400,
      );
    }

    if (!hasAnyKey(rule.requiredKeys)) {
      throw new PolicyRegistryError(
        rule.message,
        'POLICY_GOVERNANCE_DEFINITION_INVALID',
        400,
      );
    }
  }

  private formatPolicy(record: any): PolicyDefinitionSummary {
    const approvalMode = this.normalizeApprovalMode(record.approvalMode);
    const approvalTrail = this.normalizeApprovalTrail(record.approvalTrail);
    const requiredApprovalRoles = this.normalizeRequiredApprovalRoles(record.requiredApprovalRoles);
    const requiredApprovalClasses = this.normalizeRequiredApprovalClasses(record.requiredApprovalClasses);
    const requiredApprovalJurisdictions = this.normalizeRequiredApprovalJurisdictions(record.requiredApprovalJurisdictions);
    return {
      id: record.id,
      organizationId: record.organizationId,
      name: record.name,
      version: record.version,
      family: record.family,
      reference: record.reference,
      description: record.description,
      status: String(record.status ?? 'DRAFT').toLowerCase() as PolicyDefinitionStatus,
      approvalMode,
      requiredApprovals: this.normalizeRequiredApprovals(
        record.requiredApprovals,
        approvalMode,
        requiredApprovalRoles,
        requiredApprovalClasses,
        requiredApprovalJurisdictions,
      ),
      requiredApprovalRoles,
      requiredApprovalClasses,
      requiredApprovalJurisdictions,
      governanceProfileId: record.governanceProfileId ?? null,
      governanceProfileLabel: record.governanceProfileLabel ?? null,
      governancePackId: record.governancePackId ?? null,
      governancePackVersion: record.governancePackVersion ?? null,
      governancePackLabel: record.governancePackLabel ?? null,
      governanceProfileRationale: this.normalizeGovernanceRationale(record.governanceProfileRationale),
      approvalCount: approvalTrail.length,
      approvalTrail,
      definition: (record.definition ?? {}) as Record<string, unknown>,
      changeSummary: record.changeSummary ?? null,
      proposedByIdentityId: record.proposedByIdentityId,
      approvedByIdentityId: record.approvedByIdentityId ?? null,
      effectiveFrom: record.effectiveFrom ?? null,
      expiresAt: record.expiresAt ?? null,
      deprecatedAt: record.deprecatedAt ?? null,
      deprecatedByIdentityId: record.deprecatedByIdentityId ?? null,
      deprecationReason: record.deprecationReason ?? null,
      supersededByPolicyDefinitionId: record.supersededByPolicyDefinitionId ?? null,
      revokedAt: record.revokedAt ?? null,
      revokedByIdentityId: record.revokedByIdentityId ?? null,
      revocationReason: record.revocationReason ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private normalizeApprovalConfiguration(
    approvalMode: PolicyApprovalMode,
    requiredApprovals?: number,
    requiredApprovalRoles?: EnterpriseRole[],
    requiredApprovalClasses?: EnterpriseApprovalClass[],
    requiredApprovalJurisdictions?: string[],
  ): {
    approvalMode: PolicyApprovalMode;
    requiredApprovals: number;
    requiredApprovalRoles: EnterpriseRole[];
    requiredApprovalClasses: EnterpriseApprovalClass[];
    requiredApprovalJurisdictions: string[];
  } {
    const normalizedRoles = this.normalizeRequiredApprovalRoles(requiredApprovalRoles);
    const normalizedClasses = this.normalizeRequiredApprovalClasses(requiredApprovalClasses);
    const normalizedJurisdictions = this.normalizeRequiredApprovalJurisdictions(requiredApprovalJurisdictions);
    return {
      approvalMode,
      requiredApprovals: this.normalizeRequiredApprovals(
        requiredApprovals,
        approvalMode,
        normalizedRoles,
        normalizedClasses,
        normalizedJurisdictions,
      ),
      requiredApprovalRoles: normalizedRoles,
      requiredApprovalClasses: normalizedClasses,
      requiredApprovalJurisdictions: normalizedJurisdictions,
    };
  }

  private sameSet(values: string[], expected: string[]): boolean {
    const left = [...new Set(values)].sort();
    const right = [...new Set(expected)].sort();
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  private normalizeApprovalMode(value: unknown): PolicyApprovalMode {
    const normalized = String(value ?? 'SINGLE_ADMIN').toLowerCase();
    if (POLICY_APPROVAL_MODES.includes(normalized as PolicyApprovalMode)) {
      return normalized as PolicyApprovalMode;
    }
    return 'single_admin';
  }

  private normalizeRequiredApprovals(
    value: unknown,
    approvalMode: PolicyApprovalMode,
    requiredApprovalRoles: EnterpriseRole[] = [],
    requiredApprovalClasses: EnterpriseApprovalClass[] = [],
    requiredApprovalJurisdictions: string[] = [],
  ): number {
    const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 1;
    const routingMinimum = Math.max(
      requiredApprovalRoles.length,
      requiredApprovalClasses.length,
      requiredApprovalJurisdictions.length,
      1,
    );
    if (approvalMode === 'dual_control') {
      return Math.max(2, numeric, routingMinimum);
    }
    return Math.max(1, numeric, routingMinimum);
  }

  private normalizeRequiredApprovalRoles(value: unknown): EnterpriseRole[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const roles = value
      .map((entry) => String(entry))
      .filter((entry): entry is EnterpriseRole => ENTERPRISE_ROLES.includes(entry as EnterpriseRole));

    return [...new Set(roles)];
  }

  private normalizeRequiredApprovalClasses(value: unknown): EnterpriseApprovalClass[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const classes = value
      .map((entry) => String(entry))
      .filter((entry): entry is EnterpriseApprovalClass => ENTERPRISE_APPROVAL_CLASSES.includes(entry as EnterpriseApprovalClass));

    return [...new Set(classes)];
  }

  private normalizeRequiredApprovalJurisdictions(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const jurisdictions = value
      .map((entry) => String(entry))
      .filter((entry) => entry.length > 0);

    return [...new Set(jurisdictions)];
  }

  private normalizeApprovalTrail(value: unknown): PolicyApprovalTrailEntry[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry: any) => ({
        identityId: String(entry.identityId),
        role: ENTERPRISE_ROLES.includes(String(entry.role) as EnterpriseRole)
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

  private isRoleQuorumSatisfied(
    approvalTrail: PolicyApprovalTrailEntry[],
    requiredApprovalRoles: EnterpriseRole[],
  ): boolean {
    if (requiredApprovalRoles.length === 0) {
      return true;
    }

    const satisfiedRoles = new Set(approvalTrail.map((entry) => entry.role));
    return requiredApprovalRoles.every((role) => satisfiedRoles.has(role));
  }

  private isClassQuorumSatisfied(
    approvalTrail: PolicyApprovalTrailEntry[],
    requiredApprovalClasses: EnterpriseApprovalClass[],
  ): boolean {
    if (requiredApprovalClasses.length === 0) {
      return true;
    }

    const satisfiedClasses = new Set(approvalTrail.flatMap((entry) => entry.matchedApprovalClasses));
    return requiredApprovalClasses.every((approvalClass) => satisfiedClasses.has(approvalClass));
  }

  private isJurisdictionQuorumSatisfied(
    approvalTrail: PolicyApprovalTrailEntry[],
    requiredApprovalJurisdictions: string[],
  ): boolean {
    if (requiredApprovalJurisdictions.length === 0) {
      return true;
    }

    const satisfiedJurisdictions = new Set(approvalTrail.flatMap((entry) => entry.matchedApprovalJurisdictions));
    return requiredApprovalJurisdictions.every((jurisdiction) => satisfiedJurisdictions.has(jurisdiction));
  }
}

export const policyRegistryService = new PolicyRegistryService();
