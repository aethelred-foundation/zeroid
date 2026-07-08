import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../runtime';
import { policyGovernanceService } from './policy-governance-service';

export const ENTERPRISE_ROLES = [
  'viewer',
  'operator',
  'admin',
  'compliance_officer',
  'auditor',
] as const;

export type EnterpriseRole = (typeof ENTERPRISE_ROLES)[number];

export const ENTERPRISE_APPROVAL_CLASSES = [
  'admin',
  'auditor',
  'compliance',
  'legal',
  'operator',
  'privacy',
  'risk',
  'sovereign_operator',
] as const;

export type EnterpriseApprovalClass =
  (typeof ENTERPRISE_APPROVAL_CLASSES)[number];

export const ENTERPRISE_GOVERNANCE_FAMILIES = [
  'compliance',
  'reporting',
  'privacy',
  'screening',
] as const;

export type EnterpriseGovernanceFamily =
  (typeof ENTERPRISE_GOVERNANCE_FAMILIES)[number];

const GovernancePackSelectionSchema = z.object({
  packId: z.string().min(1).max(120),
  version: z.string().min(1).max(32).optional(),
});

const GovernanceChangeRecordSchema = z.object({
  changedAt: z.string().datetime(),
  changedByIdentityId: z.string().min(1),
  changeReason: z.string().min(1).max(240).optional(),
  defaultPack: GovernancePackSelectionSchema.optional(),
  familyPacks: z
    .object({
      compliance: GovernancePackSelectionSchema.optional(),
      reporting: GovernancePackSelectionSchema.optional(),
      privacy: GovernancePackSelectionSchema.optional(),
      screening: GovernancePackSelectionSchema.optional(),
    })
    .partial()
    .optional(),
});

export const UpdateOrganizationGovernanceSchema = z.object({
  defaultPack: GovernancePackSelectionSchema.optional(),
  familyPacks: z
    .object({
      compliance: GovernancePackSelectionSchema.optional(),
      reporting: GovernancePackSelectionSchema.optional(),
      privacy: GovernancePackSelectionSchema.optional(),
      screening: GovernancePackSelectionSchema.optional(),
    })
    .partial()
    .optional(),
  changeReason: z.string().min(1).max(240).optional(),
});

export interface GovernancePackSelection {
  packId: string;
  version?: string;
}

export interface GovernanceChangeRecord {
  changedAt: string;
  changedByIdentityId: string;
  changeReason?: string;
  defaultPack?: GovernancePackSelection;
  familyPacks?: Partial<
    Record<EnterpriseGovernanceFamily, GovernancePackSelection>
  >;
}

export interface OrganizationGovernanceSettings {
  defaultPack?: GovernancePackSelection;
  familyPacks?: Partial<
    Record<EnterpriseGovernanceFamily, GovernancePackSelection>
  >;
  lastUpdatedAt?: string;
  lastUpdatedByIdentityId?: string;
  changeHistory?: GovernanceChangeRecord[];
}

export const CreateOrganizationSchema = z.object({
  name: z.string().min(1).max(200),
  domain: z.string().min(1).max(255).optional(),
  plan: z.enum(['starter', 'growth', 'enterprise']).default('starter'),
  jurisdictions: z.array(z.string().min(2).max(16)).default([]),
  settings: z.record(z.unknown()).optional(),
  billingEmail: z.string().email().optional(),
});

export type CreateOrganizationInput = z.infer<typeof CreateOrganizationSchema>;

export const AddOrganizationMemberSchema = z.object({
  identityId: z.string().min(1),
  role: z.enum(ENTERPRISE_ROLES).default('viewer'),
  permissions: z.array(z.string()).default([]),
});

export type AddOrganizationMemberInput = z.infer<
  typeof AddOrganizationMemberSchema
>;
export type UpdateOrganizationGovernanceInput = z.infer<
  typeof UpdateOrganizationGovernanceSchema
>;

export interface EnterpriseContext {
  organizationId: string;
  organizationName: string;
  role: EnterpriseRole;
  permissions: string[];
  plan: string;
  jurisdictions: string[];
  governanceSettings: OrganizationGovernanceSettings;
}

export interface EnterpriseApprovalAuthority extends EnterpriseContext {
  approvalClasses: EnterpriseApprovalClass[];
  approvalJurisdictions: string[];
}

const ALL_ENTERPRISE_ROLES = new Set<EnterpriseRole>(ENTERPRISE_ROLES);
const ALL_ENTERPRISE_APPROVAL_CLASSES = new Set<EnterpriseApprovalClass>(
  ENTERPRISE_APPROVAL_CLASSES,
);

export class EnterpriseOrganizationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'EnterpriseOrganizationError';
  }
}

export class EnterpriseOrganizationService {
  async createOrganization(
    ownerIdentityId: string,
    input: CreateOrganizationInput,
  ): Promise<{
    organization: {
      id: string;
      name: string;
      domain: string | null;
      plan: string;
      jurisdictions: string[];
      governanceSettings: OrganizationGovernanceSettings;
      billingEmail: string | null;
      createdAt: Date;
    };
    membership: {
      role: EnterpriseRole;
      permissions: string[];
      joinedAt: Date;
    };
  }> {
    const parsed = CreateOrganizationSchema.parse(input);
    const governanceSettings = this.enforceGovernanceSelections(
      this.normalizeGovernanceSettings(
        (parsed.settings as Record<string, unknown> | undefined)?.governance,
      ),
      parsed.plan,
      parsed.jurisdictions,
    );

    const organizationSettings = {
      ...(parsed.settings ?? {}),
      governance: governanceSettings,
    } as unknown as Prisma.InputJsonObject;

    const organization = await prisma.organization.create({
      data: {
        name: parsed.name,
        domain: parsed.domain,
        plan: parsed.plan,
        jurisdictions: parsed.jurisdictions,
        settings: organizationSettings,
        billingEmail: parsed.billingEmail,
      },
    });

    const membership = await prisma.organizationMember.create({
      data: {
        organizationId: organization.id,
        identityId: ownerIdentityId,
        role: 'admin',
        permissions: [
          'org:manage',
          'members:manage',
          'oidc:manage',
          'api_keys:manage',
        ],
        joinedAt: new Date(),
      },
    });

    return {
      organization: {
        id: organization.id,
        name: organization.name,
        domain: organization.domain,
        plan: organization.plan,
        jurisdictions: organization.jurisdictions,
        governanceSettings: this.extractGovernanceSettings(
          organization.settings,
        ),
        billingEmail: organization.billingEmail,
        createdAt: organization.createdAt,
      },
      membership: {
        role: membership.role as EnterpriseRole,
        permissions: membership.permissions,
        joinedAt: membership.joinedAt ?? membership.invitedAt,
      },
    };
  }

  async listOrganizations(identityId: string): Promise<
    Array<{
      organizationId: string;
      organizationName: string;
      domain: string | null;
      plan: string;
      jurisdictions: string[];
      governanceSettings: OrganizationGovernanceSettings;
      role: EnterpriseRole;
      permissions: string[];
      joinedAt: Date | null;
    }>
  > {
    const memberships = await prisma.organizationMember.findMany({
      where: { identityId },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            domain: true,
            plan: true,
            jurisdictions: true,
            settings: true,
          },
        },
      },
      orderBy: {
        invitedAt: 'asc',
      },
    });

    return memberships.map((membership: any) => ({
      organizationId: membership.organization.id,
      organizationName: membership.organization.name,
      domain: membership.organization.domain,
      plan: membership.organization.plan,
      jurisdictions: membership.organization.jurisdictions,
      governanceSettings: this.extractGovernanceSettings(
        membership.organization.settings,
      ),
      role: membership.role as EnterpriseRole,
      permissions: membership.permissions,
      joinedAt: membership.joinedAt,
    }));
  }

  async addMember(
    organizationId: string,
    input: AddOrganizationMemberInput,
  ): Promise<{
    organizationId: string;
    identityId: string;
    role: EnterpriseRole;
    permissions: string[];
    invitedAt: Date;
    joinedAt: Date | null;
  }> {
    const parsed = AddOrganizationMemberSchema.parse(input);

    const identity = await prisma.identity.findUnique({
      where: { id: parsed.identityId },
      select: { id: true, status: true },
    });

    if (!identity || identity.status !== 'ACTIVE') {
      throw new EnterpriseOrganizationError(
        'Target identity not found or inactive',
        'ENTERPRISE_MEMBER_IDENTITY_INVALID',
        404,
      );
    }

    const membership = await prisma.organizationMember.upsert({
      where: {
        organizationId_identityId: {
          organizationId,
          identityId: parsed.identityId,
        },
      },
      update: {
        role: parsed.role,
        permissions: parsed.permissions,
        joinedAt: new Date(),
      },
      create: {
        organizationId,
        identityId: parsed.identityId,
        role: parsed.role,
        permissions: parsed.permissions,
        joinedAt: new Date(),
      },
    });

    return {
      organizationId: membership.organizationId,
      identityId: membership.identityId,
      role: membership.role as EnterpriseRole,
      permissions: membership.permissions,
      invitedAt: membership.invitedAt,
      joinedAt: membership.joinedAt,
    };
  }

  async listMembers(organizationId: string): Promise<
    Array<{
      organizationId: string;
      identityId: string;
      role: EnterpriseRole;
      permissions: string[];
      invitedAt: Date;
      joinedAt: Date | null;
    }>
  > {
    const memberships = await prisma.organizationMember.findMany({
      where: { organizationId },
      orderBy: {
        invitedAt: 'asc',
      },
    });

    return memberships.map((membership: any) => ({
      organizationId: membership.organizationId,
      identityId: membership.identityId,
      role: membership.role as EnterpriseRole,
      permissions: membership.permissions,
      invitedAt: membership.invitedAt,
      joinedAt: membership.joinedAt,
    }));
  }

  async getGovernanceSettings(
    organizationId: string,
  ): Promise<OrganizationGovernanceSettings> {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, plan: true, jurisdictions: true, settings: true },
    });

    if (!organization) {
      throw new EnterpriseOrganizationError(
        'Organization not found',
        'ENTERPRISE_ORGANIZATION_NOT_FOUND',
        404,
      );
    }

    return this.extractGovernanceSettings(organization.settings);
  }

  async updateGovernanceSettings(
    organizationId: string,
    actorIdentityId: string,
    input: UpdateOrganizationGovernanceInput,
  ): Promise<OrganizationGovernanceSettings> {
    const parsed = UpdateOrganizationGovernanceSchema.parse(input);
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, plan: true, jurisdictions: true, settings: true },
    });

    if (!organization) {
      throw new EnterpriseOrganizationError(
        'Organization not found',
        'ENTERPRISE_ORGANIZATION_NOT_FOUND',
        404,
      );
    }

    const currentGovernance = this.extractGovernanceSettings(
      organization.settings,
    );
    const changedAt = new Date().toISOString();
    const hydratedGovernance = this.enforceGovernanceSelections(
      this.normalizeGovernanceSettings({
        defaultPack: parsed.defaultPack ?? currentGovernance.defaultPack,
        familyPacks: {
          ...(currentGovernance.familyPacks ?? {}),
          ...(parsed.familyPacks ?? {}),
        },
      }),
      organization.plan,
      organization.jurisdictions,
    );
    const nextGovernance = {
      ...hydratedGovernance,
      lastUpdatedAt: changedAt,
      lastUpdatedByIdentityId: actorIdentityId,
      changeHistory: this.nextGovernanceHistory(
        currentGovernance.changeHistory,
        {
          changedAt,
          changedByIdentityId: actorIdentityId,
          ...(parsed.changeReason ? { changeReason: parsed.changeReason } : {}),
          ...(parsed.defaultPack && hydratedGovernance.defaultPack
            ? { defaultPack: hydratedGovernance.defaultPack }
            : {}),
          ...(parsed.familyPacks && Object.keys(parsed.familyPacks).length > 0
            ? {
                familyPacks: Object.entries(parsed.familyPacks).reduce<
                  Partial<
                    Record<EnterpriseGovernanceFamily, GovernancePackSelection>
                  >
                >((acc, [family]) => {
                  const normalizedFamily = family as EnterpriseGovernanceFamily;
                  const selection =
                    hydratedGovernance.familyPacks?.[normalizedFamily];
                  if (selection) {
                    acc[normalizedFamily] = selection;
                  }
                  return acc;
                }, {}),
              }
            : {}),
        },
      ),
    };
    const currentSettings = this.asSettingsRecord(organization.settings);
    const updatedSettings = {
      ...currentSettings,
      governance: nextGovernance,
    } as unknown as Prisma.InputJsonObject;
    const updated = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        settings: updatedSettings,
      },
      select: {
        settings: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        identityId: actorIdentityId,
        action: 'IDENTITY_UPDATED',
        resourceType: 'organization_governance',
        resourceId: organizationId,
        details: {
          organizationId,
          governance: nextGovernance,
        } as unknown as Prisma.InputJsonObject,
      },
    });

    return this.extractGovernanceSettings(updated.settings);
  }

  async resolveContext(
    identityId: string,
    requestedOrganizationId?: string,
    requiredRoles: EnterpriseRole[] = ENTERPRISE_ROLES.slice(),
  ): Promise<EnterpriseContext> {
    const memberships = await prisma.organizationMember.findMany({
      where: { identityId },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            plan: true,
            jurisdictions: true,
            settings: true,
          },
        },
      },
      orderBy: {
        invitedAt: 'asc',
      },
    });

    if (memberships.length === 0) {
      throw new EnterpriseOrganizationError(
        'No enterprise organization membership found for this identity',
        'ENTERPRISE_MEMBERSHIP_REQUIRED',
        403,
      );
    }

    for (const role of requiredRoles) {
      if (!ALL_ENTERPRISE_ROLES.has(role)) {
        throw new EnterpriseOrganizationError(
          `Unsupported enterprise role requirement: ${role}`,
          'ENTERPRISE_ROLE_INVALID',
          500,
        );
      }
    }

    let membership = memberships[0];

    if (requestedOrganizationId) {
      const matching = memberships.find(
        (entry: any) => entry.organizationId === requestedOrganizationId,
      );
      if (!matching) {
        throw new EnterpriseOrganizationError(
          'Requested organization is not associated with this identity',
          'ENTERPRISE_ORGANIZATION_FORBIDDEN',
          403,
        );
      }
      membership = matching;
    } else if (memberships.length > 1) {
      throw new EnterpriseOrganizationError(
        'Multiple enterprise organizations found. Specify x-zeroid-org-id or organizationId.',
        'ENTERPRISE_ORGANIZATION_SELECTION_REQUIRED',
        409,
      );
    }

    const resolvedRole = membership.role as EnterpriseRole;
    if (!requiredRoles.includes(resolvedRole)) {
      throw new EnterpriseOrganizationError(
        `Enterprise role ${resolvedRole} is not allowed for this action`,
        'ENTERPRISE_ROLE_FORBIDDEN',
        403,
      );
    }

    return {
      organizationId: membership.organizationId,
      organizationName: membership.organization.name,
      role: resolvedRole,
      permissions: membership.permissions,
      plan: membership.organization.plan,
      jurisdictions: membership.organization.jurisdictions,
      governanceSettings: this.extractGovernanceSettings(
        membership.organization.settings,
      ),
    };
  }

  async requireEnterpriseContext(
    identityId: string,
    organizationId?: string,
    requiredRoles: EnterpriseRole[] = ENTERPRISE_ROLES.slice(),
  ): Promise<EnterpriseContext> {
    return this.resolveContext(identityId, organizationId, requiredRoles);
  }

  async getApprovalAuthority(
    identityId: string,
    organizationId?: string,
  ): Promise<EnterpriseApprovalAuthority> {
    const context = await this.resolveContext(
      identityId,
      organizationId,
      ENTERPRISE_ROLES.slice(),
    );
    return {
      ...context,
      approvalClasses: this.deriveApprovalClasses(
        context.role,
        context.permissions,
      ),
      approvalJurisdictions: this.deriveApprovalJurisdictions(
        context.permissions,
        context.jurisdictions,
      ),
    };
  }

  private deriveApprovalClasses(
    role: EnterpriseRole,
    permissions: string[],
  ): EnterpriseApprovalClass[] {
    const classes = new Set<EnterpriseApprovalClass>();

    switch (role) {
      case 'admin':
        classes.add('admin');
        break;
      case 'auditor':
        classes.add('auditor');
        break;
      case 'compliance_officer':
        classes.add('compliance');
        classes.add('risk');
        break;
      case 'operator':
        classes.add('operator');
        break;
      default:
        break;
    }

    for (const permission of permissions) {
      if (!permission.startsWith('approval:class:')) {
        continue;
      }

      const approvalClass = permission.slice(
        'approval:class:'.length,
      ) as EnterpriseApprovalClass;
      if (ALL_ENTERPRISE_APPROVAL_CLASSES.has(approvalClass)) {
        classes.add(approvalClass);
      }
    }

    return [...classes];
  }

  private deriveApprovalJurisdictions(
    permissions: string[],
    defaultJurisdictions: string[],
  ): string[] {
    const explicitJurisdictions = permissions
      .filter((permission) => permission.startsWith('approval:jurisdiction:'))
      .map((permission) => permission.slice('approval:jurisdiction:'.length))
      .filter((jurisdiction) => jurisdiction.length > 0);

    if (explicitJurisdictions.length > 0) {
      return [...new Set(explicitJurisdictions)];
    }

    return [...new Set(defaultJurisdictions)];
  }

  private extractGovernanceSettings(
    settings: unknown,
  ): OrganizationGovernanceSettings {
    return this.normalizeGovernanceSettings(
      this.asSettingsRecord(settings).governance,
    );
  }

  private normalizeGovernanceSettings(
    value: unknown,
  ): OrganizationGovernanceSettings {
    const record = this.asSettingsRecord(value);
    const result = UpdateOrganizationGovernanceSchema.safeParse(record ?? {});
    const history = this.normalizeGovernanceHistory(record.changeHistory);

    if (result.success) {
      const { changeReason: _changeReason, ...normalized } = result.data;
      return {
        ...normalized,
        ...(typeof record.lastUpdatedAt === 'string' &&
        record.lastUpdatedAt.length > 0
          ? { lastUpdatedAt: record.lastUpdatedAt }
          : {}),
        ...(typeof record.lastUpdatedByIdentityId === 'string' &&
        record.lastUpdatedByIdentityId.length > 0
          ? { lastUpdatedByIdentityId: record.lastUpdatedByIdentityId }
          : {}),
        ...(history.length > 0 ? { changeHistory: history } : {}),
      };
    }
    return {};
  }

  private normalizeGovernanceHistory(value: unknown): GovernanceChangeRecord[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => GovernanceChangeRecordSchema.safeParse(entry))
      .filter((entry) => entry.success)
      .map((entry) => entry.data)
      .slice(-20);
  }

  private nextGovernanceHistory(
    existing: GovernanceChangeRecord[] | undefined,
    next: GovernanceChangeRecord,
  ): GovernanceChangeRecord[] {
    return [...(existing ?? []), next].slice(-20);
  }

  private enforceGovernanceSelections(
    settings: OrganizationGovernanceSettings,
    organizationPlan: string,
    organizationJurisdictions: string[],
  ): OrganizationGovernanceSettings {
    const availablePacks = new Map(
      policyGovernanceService
        .listGovernancePacks()
        .map((pack) => [pack.id, pack]),
    );

    const hydrateSelection = (
      selection: GovernancePackSelection | undefined,
    ): GovernancePackSelection | undefined => {
      if (!selection) {
        return undefined;
      }

      const matchedPack = availablePacks.get(selection.packId);
      if (!matchedPack) {
        throw new EnterpriseOrganizationError(
          `Unknown governance pack: ${selection.packId}`,
          'ENTERPRISE_GOVERNANCE_PACK_INVALID',
          400,
        );
      }

      if (selection.version && selection.version !== matchedPack.version) {
        throw new EnterpriseOrganizationError(
          `Unsupported governance pack version for ${selection.packId}: ${selection.version}`,
          'ENTERPRISE_GOVERNANCE_PACK_INVALID',
          400,
        );
      }

      return {
        packId: matchedPack.id,
        version: matchedPack.version,
      };
    };

    const defaultPack = hydrateSelection(settings.defaultPack);
    const familyPacks = Object.entries(settings.familyPacks ?? {}).reduce<
      Partial<Record<EnterpriseGovernanceFamily, GovernancePackSelection>>
    >((acc, [family, selection]) => {
      const normalizedFamily = family as EnterpriseGovernanceFamily;
      const hydrated = hydrateSelection(selection);
      if (hydrated) {
        acc[normalizedFamily] = hydrated;
      }
      return acc;
    }, {});

    const normalizedSettings: OrganizationGovernanceSettings = {
      ...(defaultPack ? { defaultPack } : {}),
      ...(Object.keys(familyPacks).length > 0 ? { familyPacks } : {}),
      ...(settings.lastUpdatedAt
        ? { lastUpdatedAt: settings.lastUpdatedAt }
        : {}),
      ...(settings.lastUpdatedByIdentityId
        ? { lastUpdatedByIdentityId: settings.lastUpdatedByIdentityId }
        : {}),
      ...(settings.changeHistory && settings.changeHistory.length > 0
        ? { changeHistory: settings.changeHistory }
        : {}),
    };

    const compatibilityIssues =
      policyGovernanceService.validateGovernanceSettings({
        organizationPlan,
        organizationJurisdictions,
        settings: normalizedSettings,
      });
    if (compatibilityIssues.length > 0) {
      throw new EnterpriseOrganizationError(
        compatibilityIssues[0]?.reason ??
          'Organization governance settings are not compatible with this tenant.',
        'ENTERPRISE_GOVERNANCE_PACK_INVALID',
        400,
      );
    }

    return normalizedSettings;
  }

  private asSettingsRecord(settings: unknown): Record<string, unknown> {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return {};
    }
    return settings as Record<string, unknown>;
  }
}

export const enterpriseOrganizationService =
  new EnterpriseOrganizationService();
