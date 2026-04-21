import { z } from 'zod';
import { prisma } from '../../index';

export const POLICY_DEFINITION_STATUSES = [
  'draft',
  'pending_review',
  'approved',
  'deprecated',
] as const;

export type PolicyDefinitionStatus = typeof POLICY_DEFINITION_STATUSES[number];

export const CreatePolicyDefinitionSchema = z.object({
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(64),
  family: z.enum(['compliance', 'reporting', 'privacy', 'screening']),
  description: z.string().min(10).max(500),
  definition: z.record(z.unknown()),
  changeSummary: z.string().min(5).max(500).optional(),
  effectiveFrom: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
});

export type CreatePolicyDefinitionInput = z.infer<typeof CreatePolicyDefinitionSchema>;

export const ListPolicyDefinitionsSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  status: z.enum(POLICY_DEFINITION_STATUSES).optional(),
});

export type ListPolicyDefinitionsInput = z.infer<typeof ListPolicyDefinitionsSchema>;

export interface PolicyDefinitionSummary {
  id: string;
  organizationId: string;
  name: string;
  version: string;
  family: string;
  reference: string;
  description: string;
  status: PolicyDefinitionStatus;
  definition: Record<string, unknown>;
  changeSummary: string | null;
  proposedByIdentityId: string;
  approvedByIdentityId: string | null;
  effectiveFrom: Date | null;
  expiresAt: Date | null;
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

    if (record.status !== 'DRAFT') {
      throw new PolicyRegistryError(
        'Only draft policies can be submitted for review',
        'POLICY_SUBMIT_INVALID_STATE',
        409,
      );
    }

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

    if (!['DRAFT', 'PENDING_REVIEW'].includes(record.status)) {
      throw new PolicyRegistryError(
        'Only draft or pending-review policies can be approved',
        'POLICY_APPROVE_INVALID_STATE',
        409,
      );
    }

    const effectiveAt = effectiveFrom ? new Date(effectiveFrom) : record.effectiveFrom ?? new Date();
    const updated = await model.update({
      where: { id: policyId },
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
        resourceType: 'policy_definition',
        resourceId: policyId,
        previousState: { status: record.status },
        newState: { status: 'APPROVED', effectiveFrom: effectiveAt.toISOString() },
        details: {
          organizationId,
          name: record.name,
          version: record.version,
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

  private formatPolicy(record: any): PolicyDefinitionSummary {
    return {
      id: record.id,
      organizationId: record.organizationId,
      name: record.name,
      version: record.version,
      family: record.family,
      reference: record.reference,
      description: record.description,
      status: String(record.status ?? 'DRAFT').toLowerCase() as PolicyDefinitionStatus,
      definition: (record.definition ?? {}) as Record<string, unknown>,
      changeSummary: record.changeSummary ?? null,
      proposedByIdentityId: record.proposedByIdentityId,
      approvedByIdentityId: record.approvedByIdentityId ?? null,
      effectiveFrom: record.effectiveFrom ?? null,
      expiresAt: record.expiresAt ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}

export const policyRegistryService = new PolicyRegistryService();
