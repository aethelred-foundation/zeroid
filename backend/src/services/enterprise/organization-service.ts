import { z } from 'zod';
import { prisma } from '../../index';

export const ENTERPRISE_ROLES = [
  'viewer',
  'operator',
  'admin',
  'compliance_officer',
  'auditor',
] as const;

export type EnterpriseRole = typeof ENTERPRISE_ROLES[number];

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

export type EnterpriseApprovalClass = typeof ENTERPRISE_APPROVAL_CLASSES[number];

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

export type AddOrganizationMemberInput = z.infer<typeof AddOrganizationMemberSchema>;

export interface EnterpriseContext {
  organizationId: string;
  organizationName: string;
  role: EnterpriseRole;
  permissions: string[];
  plan: string;
  jurisdictions: string[];
}

export interface EnterpriseApprovalAuthority extends EnterpriseContext {
  approvalClasses: EnterpriseApprovalClass[];
  approvalJurisdictions: string[];
}

const ALL_ENTERPRISE_ROLES = new Set<EnterpriseRole>(ENTERPRISE_ROLES);
const ALL_ENTERPRISE_APPROVAL_CLASSES = new Set<EnterpriseApprovalClass>(ENTERPRISE_APPROVAL_CLASSES);

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

    const organization = await prisma.organization.create({
      data: {
        name: parsed.name,
        domain: parsed.domain,
        plan: parsed.plan,
        jurisdictions: parsed.jurisdictions,
        settings: parsed.settings,
        billingEmail: parsed.billingEmail,
      },
    });

    const membership = await prisma.organizationMember.create({
      data: {
        organizationId: organization.id,
        identityId: ownerIdentityId,
        role: 'admin',
        permissions: ['org:manage', 'members:manage', 'oidc:manage', 'api_keys:manage'],
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

  async listOrganizations(identityId: string): Promise<Array<{
    organizationId: string;
    organizationName: string;
    domain: string | null;
    plan: string;
    jurisdictions: string[];
    role: EnterpriseRole;
    permissions: string[];
    joinedAt: Date | null;
  }>> {
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

  async listMembers(organizationId: string): Promise<Array<{
    organizationId: string;
    identityId: string;
    role: EnterpriseRole;
    permissions: string[];
    invitedAt: Date;
    joinedAt: Date | null;
  }>> {
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
      const matching = memberships.find((entry: any) => entry.organizationId === requestedOrganizationId);
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
    const context = await this.resolveContext(identityId, organizationId, ENTERPRISE_ROLES.slice());
    return {
      ...context,
      approvalClasses: this.deriveApprovalClasses(context.role, context.permissions),
      approvalJurisdictions: this.deriveApprovalJurisdictions(context.permissions, context.jurisdictions),
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

      const approvalClass = permission.slice('approval:class:'.length) as EnterpriseApprovalClass;
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
}

export const enterpriseOrganizationService = new EnterpriseOrganizationService();
