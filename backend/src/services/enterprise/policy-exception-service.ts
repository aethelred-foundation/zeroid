import { z } from 'zod';
import { prisma } from '../../index';
import { policyRegistryService } from './policy-registry-service';

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
  effectiveFrom: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreatePolicyExceptionInput = z.infer<typeof CreatePolicyExceptionSchema>;

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
  status: PolicyExceptionStatus;
  requestedByIdentityId: string;
  approvedByIdentityId: string | null;
  effectiveFrom: Date | null;
  expiresAt: Date | null;
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

    if (record.status !== 'PENDING_REVIEW') {
      throw new PolicyExceptionError(
        'Only pending exceptions can be approved',
        'POLICY_EXCEPTION_APPROVE_INVALID_STATE',
        409,
      );
    }

    const effectiveAt = effectiveFrom ? new Date(effectiveFrom) : record.effectiveFrom ?? new Date();
    const updated = await model.update({
      where: { id: exceptionId },
      data: {
        status: 'APPROVED',
        approvedByIdentityId: actorIdentityId,
        effectiveFrom: effectiveAt,
      },
    });

    await prisma.auditLog.create({
      data: {
        identityId: actorIdentityId,
        action: 'SCHEMA_APPROVED',
        resourceType: 'policy_exception',
        resourceId: exceptionId,
        previousState: { status: record.status },
        newState: { status: 'APPROVED', effectiveFrom: effectiveAt.toISOString() },
        details: {
          organizationId,
          policyName: record.policyName,
          policyVersion: record.policyVersion,
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
      status: String(record.status ?? 'PENDING_REVIEW').toLowerCase() as PolicyExceptionStatus,
      requestedByIdentityId: record.requestedByIdentityId,
      approvedByIdentityId: record.approvedByIdentityId ?? null,
      effectiveFrom: record.effectiveFrom ?? null,
      expiresAt: record.expiresAt ?? null,
      metadata: (record.metadata ?? null) as Record<string, unknown> | null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}

export const policyExceptionService = new PolicyExceptionService();
