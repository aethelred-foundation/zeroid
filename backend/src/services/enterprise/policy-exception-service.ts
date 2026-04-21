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
import { POLICY_APPROVAL_MODES, type PolicyApprovalMode, type PolicyApprovalTrailEntry, policyRegistryService } from './policy-registry-service';

export const POLICY_EXCEPTION_STATUSES = [
  'pending_review',
  'approved',
  'rejected',
  'revoked',
] as const;

export type PolicyExceptionStatus = typeof POLICY_EXCEPTION_STATUSES[number];

export const CreatePolicyExceptionSchema = z.object({
  policyName: z.string().min(1).max(120),
  subjectEntityId: z.string().min(1).max(255).optional(),
  scope: z.enum(['subject', 'organization', 'jurisdiction']).default('subject'),
  justification: z.string().min(20).max(1000),
  conditions: z.record(z.unknown()).optional(),
  approvalMode: z.enum(POLICY_APPROVAL_MODES).default('single_admin'),
  requiredApprovals: z.number().int().min(1).max(5).optional(),
  requiredApprovalRoles: z.array(z.enum(ENTERPRISE_ROLES)).max(5).optional(),
  requiredApprovalClasses: z.array(z.enum(ENTERPRISE_APPROVAL_CLASSES)).max(8).optional(),
  requiredApprovalJurisdictions: z.array(z.string().min(2).max(32)).max(16).optional(),
  effectiveFrom: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreatePolicyExceptionInput = z.infer<typeof CreatePolicyExceptionSchema>;

export const RevokePolicyExceptionSchema = z.object({
  reason: z.string().min(10).max(500).optional(),
  revokedAt: z.string().datetime().optional(),
});

export type RevokePolicyExceptionInput = z.infer<typeof RevokePolicyExceptionSchema>;

export interface PolicyExceptionSummary {
  id: string;
  organizationId: string;
  policyDefinitionId: string | null;
  policyName: string;
  policyVersion: string;
  policyReference: string;
  subjectEntityId: string | null;
  scope: string;
  justification: string;
  conditions: Record<string, unknown> | null;
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
  status: PolicyExceptionStatus;
  requestedByIdentityId: string;
  approvedByIdentityId: string | null;
  effectiveFrom: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedByIdentityId: string | null;
  revocationReason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export class PolicyExceptionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'PolicyExceptionError';
  }
}

export class PolicyExceptionService {
  async createExceptionRequest(
    organizationId: string,
    requestedByIdentityId: string,
    input: CreatePolicyExceptionInput,
  ): Promise<PolicyExceptionSummary> {
    const parsed = CreatePolicyExceptionSchema.parse(input);
    const policy = await policyRegistryService.getEffectivePolicy(organizationId, parsed.policyName);
    if (!policy) {
      throw new PolicyExceptionError(
        'Active policy definition not found for exception request',
        'POLICY_EXCEPTION_POLICY_NOT_FOUND',
        404,
      );
    }

    const model = this.getExceptionModel();
    const governanceContext = await enterpriseOrganizationService.getApprovalAuthority(
      requestedByIdentityId,
      organizationId,
    );
    const governanceProfile = policyGovernanceService.applyGovernanceBaseline({
      organizationPlan: governanceContext.plan,
      organizationJurisdictions: governanceContext.jurisdictions,
      organizationGovernanceSettings: governanceContext.governanceSettings,
      policyName: parsed.policyName,
      family: (policy.family ?? 'compliance') as 'compliance' | 'reporting' | 'privacy' | 'screening',
      approvalMode: parsed.approvalMode,
      requiredApprovals: parsed.requiredApprovals,
      requiredApprovalRoles: parsed.requiredApprovalRoles,
      requiredApprovalClasses: parsed.requiredApprovalClasses,
      requiredApprovalJurisdictions: parsed.requiredApprovalJurisdictions,
    });
    const approvalConfig = this.normalizeApprovalConfiguration(
      governanceProfile.approvalMode,
      governanceProfile.requiredApprovals,
      governanceProfile.requiredApprovalRoles,
      governanceProfile.requiredApprovalClasses,
      governanceProfile.requiredApprovalJurisdictions,
    );
    const record = await model.create({
      data: {
        organizationId,
        policyDefinitionId: policy.id,
        policyName: policy.name,
        policyVersion: policy.version,
        policyReference: policy.reference,
        subjectEntityId: parsed.subjectEntityId ?? null,
        scope: parsed.scope.toUpperCase(),
        justification: parsed.justification,
        conditions: parsed.conditions,
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
        status: 'PENDING_REVIEW',
        requestedByIdentityId,
        effectiveFrom: parsed.effectiveFrom ? new Date(parsed.effectiveFrom) : null,
        expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
        metadata: parsed.metadata,
      },
    });

    await prisma.auditLog.create({
      data: {
        identityId: requestedByIdentityId,
        action: 'SCHEMA_PROPOSED',
        resourceType: 'policy_exception',
        resourceId: record.id,
        details: {
          organizationId,
          policyName: policy.name,
          policyVersion: policy.version,
          scope: parsed.scope,
          subjectEntityId: parsed.subjectEntityId ?? null,
          governanceProfileId: governanceProfile.governanceProfileId,
          governanceProfileLabel: governanceProfile.governanceProfileLabel,
          governanceProfileRationale: governanceProfile.governanceRationale,
        },
      },
    });

    return this.formatException(record);
  }

  async listExceptions(
    organizationId: string,
    filters: {
      policyName?: string;
      status?: PolicyExceptionStatus;
      subjectEntityId?: string;
    } = {},
  ): Promise<PolicyExceptionSummary[]> {
    const model = this.getExceptionModel();
    const records = await model.findMany({
      where: {
        organizationId,
        ...(filters.policyName ? { policyName: filters.policyName } : {}),
        ...(filters.status ? { status: filters.status.toUpperCase() } : {}),
        ...(filters.subjectEntityId ? { subjectEntityId: filters.subjectEntityId } : {}),
      },
      orderBy: [
        { createdAt: 'desc' },
      ],
    });

    return records.map((record: any) => this.formatException(record));
  }

  async approveException(
    exceptionId: string,
    organizationId: string,
    actorIdentityId: string,
    effectiveFrom?: string,
  ): Promise<PolicyExceptionSummary> {
    const model = this.getExceptionModel();
    const record = await this.getException(exceptionId, organizationId);
    const actorAuthority = await enterpriseOrganizationService.getApprovalAuthority(actorIdentityId, organizationId);
    const actorRole = actorAuthority.role;

    if (record.status !== 'PENDING_REVIEW') {
      throw new PolicyExceptionError(
        'Only pending exceptions can be approved',
        'POLICY_EXCEPTION_APPROVE_INVALID_STATE',
        409,
      );
    }

    const approvalMode = this.normalizeApprovalMode(record.approvalMode);
    const requiredApprovalRoles = this.normalizeRequiredApprovalRoles(record.requiredApprovalRoles);
    const requiredApprovalClasses = this.normalizeRequiredApprovalClasses(record.requiredApprovalClasses);
    const requiredApprovalJurisdictions = this.normalizeRequiredApprovalJurisdictions(record.requiredApprovalJurisdictions);
    if (approvalMode !== 'single_admin' && record.requestedByIdentityId === actorIdentityId) {
      throw new PolicyExceptionError(
        'Policy exception approval requires separation of duties',
        'POLICY_EXCEPTION_APPROVE_SOD_REQUIRED',
        409,
      );
    }

    if (requiredApprovalRoles.length > 0 && !requiredApprovalRoles.includes(actorRole)) {
      throw new PolicyExceptionError(
        `Policy exception approval requires one of these enterprise roles: ${requiredApprovalRoles.join(', ')}`,
        'POLICY_EXCEPTION_APPROVE_ROLE_NOT_ALLOWED',
        403,
      );
    }

    const matchedApprovalClasses = requiredApprovalClasses.filter((approvalClass) =>
      actorAuthority.approvalClasses.includes(approvalClass),
    );
    if (requiredApprovalClasses.length > 0 && matchedApprovalClasses.length === 0) {
      throw new PolicyExceptionError(
        `Policy exception approval requires one of these approval classes: ${requiredApprovalClasses.join(', ')}`,
        'POLICY_EXCEPTION_APPROVE_CLASS_NOT_ALLOWED',
        403,
      );
    }

    const matchedApprovalJurisdictions = requiredApprovalJurisdictions.filter((jurisdiction) =>
      actorAuthority.approvalJurisdictions.includes(jurisdiction),
    );
    if (requiredApprovalJurisdictions.length > 0 && matchedApprovalJurisdictions.length === 0) {
      throw new PolicyExceptionError(
        `Policy exception approval requires delegated jurisdiction authority for one of: ${requiredApprovalJurisdictions.join(', ')}`,
        'POLICY_EXCEPTION_APPROVE_JURISDICTION_NOT_ALLOWED',
        403,
      );
    }

    const approvalTrail = this.normalizeApprovalTrail(record.approvalTrail);
    if (approvalTrail.some((entry) => entry.identityId === actorIdentityId)) {
      throw new PolicyExceptionError(
        'This approver has already recorded an approval for the exception',
        'POLICY_EXCEPTION_APPROVE_DUPLICATE',
        409,
      );
    }
    if (
      requiredApprovalRoles.length > 1
      && requiredApprovalRoles.includes(actorRole)
      && approvalTrail.some((entry) => entry.role === actorRole)
    ) {
      throw new PolicyExceptionError(
        `Policy exception approval role ${actorRole} has already been satisfied`,
        'POLICY_EXCEPTION_APPROVE_ROLE_DUPLICATE',
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
      throw new PolicyExceptionError(
        'Policy exception approval classes already satisfied by prior approvals',
        'POLICY_EXCEPTION_APPROVE_CLASS_DUPLICATE',
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
      throw new PolicyExceptionError(
        'Policy exception approval jurisdictions already satisfied by prior approvals',
        'POLICY_EXCEPTION_APPROVE_JURISDICTION_DUPLICATE',
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
      where: { id: exceptionId },
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
        resourceType: 'policy_exception',
        resourceId: exceptionId,
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
          policyName: record.policyName,
          policyVersion: record.policyVersion,
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

    return this.formatException(updated);
  }

  async rejectException(
    exceptionId: string,
    organizationId: string,
    actorIdentityId: string,
    reason?: string,
  ): Promise<PolicyExceptionSummary> {
    const model = this.getExceptionModel();
    const record = await this.getException(exceptionId, organizationId);

    if (record.status !== 'PENDING_REVIEW') {
      throw new PolicyExceptionError(
        'Only pending exceptions can be rejected',
        'POLICY_EXCEPTION_REJECT_INVALID_STATE',
        409,
      );
    }

    const updated = await model.update({
      where: { id: exceptionId },
      data: {
        status: 'REJECTED',
        approvedByIdentityId: actorIdentityId,
        metadata: {
          ...(record.metadata ?? {}),
          rejectionReason: reason ?? 'Rejected by enterprise administrator',
        },
      },
    });

    await prisma.auditLog.create({
      data: {
        identityId: actorIdentityId,
        action: 'SCHEMA_REJECTED',
        resourceType: 'policy_exception',
        resourceId: exceptionId,
        previousState: { status: record.status },
        newState: { status: 'REJECTED' },
        details: {
          organizationId,
          policyName: record.policyName,
          policyVersion: record.policyVersion,
          rejectionReason: reason ?? 'Rejected by enterprise administrator',
        },
      },
    });

    return this.formatException(updated);
  }

  async getActiveExceptions(
    organizationId: string,
    policyName: string,
    subjectEntityId?: string,
  ): Promise<PolicyExceptionSummary[]> {
    const model = this.getExceptionModel();
    const now = new Date();
    const records = await model.findMany({
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

    return records.map((record: any) => this.formatException(record));
  }

  async revokeException(
    exceptionId: string,
    organizationId: string,
    actorIdentityId: string,
    input: RevokePolicyExceptionInput = {},
  ): Promise<PolicyExceptionSummary> {
    const parsed = RevokePolicyExceptionSchema.parse(input);
    const model = this.getExceptionModel();
    const record = await this.getException(exceptionId, organizationId);

    if (record.status !== 'APPROVED') {
      throw new PolicyExceptionError(
        'Only approved exceptions can be revoked',
        'POLICY_EXCEPTION_REVOKE_INVALID_STATE',
        409,
      );
    }

    const revokedAt = parsed.revokedAt ? new Date(parsed.revokedAt) : new Date();
    const updated = await model.update({
      where: { id: exceptionId },
      data: {
        status: 'REVOKED',
        revokedAt,
        revokedByIdentityId: actorIdentityId,
        revocationReason: parsed.reason ?? 'Revoked by enterprise administrator',
      },
    });

    await prisma.auditLog.create({
      data: {
        identityId: actorIdentityId,
        action: 'SCHEMA_REVOKED',
        resourceType: 'policy_exception',
        resourceId: exceptionId,
        previousState: { status: record.status },
        newState: {
          status: 'REVOKED',
          revokedAt: revokedAt.toISOString(),
        },
        details: {
          organizationId,
          policyName: record.policyName,
          policyVersion: record.policyVersion,
          reason: parsed.reason ?? 'Revoked by enterprise administrator',
        },
      },
    });

    return this.formatException(updated);
  }

  private async getException(exceptionId: string, organizationId: string): Promise<any> {
    const model = this.getExceptionModel();
    const record = await model.findFirst({
      where: {
        id: exceptionId,
        organizationId,
      },
    });

    if (!record) {
      throw new PolicyExceptionError(
        'Policy exception not found',
        'POLICY_EXCEPTION_NOT_FOUND',
        404,
      );
    }

    return record;
  }

  private getExceptionModel(): any {
    const model = (prisma as any).policyException;
    if (!model) {
      throw new PolicyExceptionError(
        'Policy exception model is not available in this runtime',
        'POLICY_EXCEPTION_MODEL_UNAVAILABLE',
        500,
      );
    }
    return model;
  }

  private formatException(record: any): PolicyExceptionSummary {
    const approvalMode = this.normalizeApprovalMode(record.approvalMode);
    const approvalTrail = this.normalizeApprovalTrail(record.approvalTrail);
    const requiredApprovalRoles = this.normalizeRequiredApprovalRoles(record.requiredApprovalRoles);
    const requiredApprovalClasses = this.normalizeRequiredApprovalClasses(record.requiredApprovalClasses);
    const requiredApprovalJurisdictions = this.normalizeRequiredApprovalJurisdictions(record.requiredApprovalJurisdictions);
    return {
      id: record.id,
      organizationId: record.organizationId,
      policyDefinitionId: record.policyDefinitionId ?? null,
      policyName: record.policyName,
      policyVersion: record.policyVersion,
      policyReference: record.policyReference,
      subjectEntityId: record.subjectEntityId ?? null,
      scope: String(record.scope ?? 'SUBJECT').toLowerCase(),
      justification: record.justification,
      conditions: (record.conditions ?? null) as Record<string, unknown> | null,
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
      status: String(record.status ?? 'PENDING_REVIEW').toLowerCase() as PolicyExceptionStatus,
      requestedByIdentityId: record.requestedByIdentityId,
      approvedByIdentityId: record.approvedByIdentityId ?? null,
      effectiveFrom: record.effectiveFrom ?? null,
      expiresAt: record.expiresAt ?? null,
      revokedAt: record.revokedAt ?? null,
      revokedByIdentityId: record.revokedByIdentityId ?? null,
      revocationReason: record.revocationReason ?? null,
      metadata: (record.metadata ?? null) as Record<string, unknown> | null,
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

export const policyExceptionService = new PolicyExceptionService();
