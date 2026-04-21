const mockOrganizationCreate = jest.fn();
const mockOrganizationFindUnique = jest.fn();
const mockOrganizationUpdate = jest.fn();
const mockOrganizationMemberCreate = jest.fn();
const mockOrganizationMemberFindMany = jest.fn();
const mockOrganizationMemberUpsert = jest.fn();
const mockIdentityFindUnique = jest.fn();
const mockAuditLogCreate = jest.fn();

jest.mock('../src/index', () => ({
  prisma: {
    organization: {
      create: mockOrganizationCreate,
      findUnique: mockOrganizationFindUnique,
      update: mockOrganizationUpdate,
    },
    organizationMember: {
      create: mockOrganizationMemberCreate,
      findMany: mockOrganizationMemberFindMany,
      upsert: mockOrganizationMemberUpsert,
    },
    identity: {
      findUnique: mockIdentityFindUnique,
    },
    auditLog: {
      create: mockAuditLogCreate,
    },
  },
}));

import {
  EnterpriseOrganizationError,
  enterpriseOrganizationService,
} from '../src/services/enterprise/organization-service';

describe('EnterpriseOrganizationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockOrganizationCreate.mockResolvedValue({
      id: 'org-1',
      name: 'ZeroID Sovereign Lab',
      domain: 'zeroid.example',
      plan: 'enterprise',
      jurisdictions: ['UAE', 'EU'],
      settings: {},
      billingEmail: 'ops@zeroid.example',
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
    });
    mockOrganizationFindUnique.mockResolvedValue({
      id: 'org-1',
      settings: {},
    });
    mockOrganizationUpdate.mockResolvedValue({
      settings: {
        governance: {
          defaultPack: { packId: 'sovereign-core', version: '2026.04' },
          familyPacks: {
            privacy: { packId: 'enterprise-privacy', version: '2026.04' },
          },
          lastUpdatedAt: '2026-04-21T00:00:00.000Z',
          lastUpdatedByIdentityId: 'identity-1',
          changeHistory: [
            {
              changedAt: '2026-04-21T00:00:00.000Z',
              changedByIdentityId: 'identity-1',
              changeReason: 'Move privacy workflows onto sovereign governance baseline',
              defaultPack: { packId: 'sovereign-core', version: '2026.04' },
              familyPacks: {
                privacy: { packId: 'enterprise-privacy', version: '2026.04' },
              },
            },
          ],
        },
      },
    });

    mockOrganizationMemberCreate.mockResolvedValue({
      organizationId: 'org-1',
      identityId: 'identity-1',
      role: 'admin',
      permissions: ['org:manage', 'members:manage'],
      invitedAt: new Date('2026-04-21T00:00:00.000Z'),
      joinedAt: new Date('2026-04-21T00:00:00.000Z'),
    });

    mockOrganizationMemberUpsert.mockResolvedValue({
      organizationId: 'org-1',
      identityId: 'identity-2',
      role: 'operator',
      permissions: ['reports:read'],
      invitedAt: new Date('2026-04-21T00:00:00.000Z'),
      joinedAt: new Date('2026-04-21T00:00:00.000Z'),
    });

    mockIdentityFindUnique.mockResolvedValue({
      id: 'identity-2',
      status: 'ACTIVE',
    });
  });

  it('creates an organization and bootstraps the owner as admin', async () => {
    const result = await enterpriseOrganizationService.createOrganization('identity-1', {
      name: 'ZeroID Sovereign Lab',
      domain: 'zeroid.example',
      plan: 'enterprise',
      jurisdictions: ['UAE', 'EU'],
      billingEmail: 'ops@zeroid.example',
    });

    expect(mockOrganizationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: 'ZeroID Sovereign Lab',
        domain: 'zeroid.example',
        plan: 'enterprise',
      }),
    }));
    expect(mockOrganizationMemberCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: 'org-1',
        identityId: 'identity-1',
        role: 'admin',
      }),
    }));
    expect(result.organization.id).toBe('org-1');
    expect(result.membership.role).toBe('admin');
    expect(result.organization.governanceSettings).toEqual({});
  });

  it('pins governance pack versions when organization governance settings omit them', async () => {
    await enterpriseOrganizationService.createOrganization('identity-1', {
      name: 'ZeroID Sovereign Lab',
      plan: 'enterprise',
      settings: {
        governance: {
          defaultPack: { packId: 'sovereign-core' },
          familyPacks: {
            privacy: { packId: 'enterprise-privacy' },
          },
        },
      },
    });

    expect(mockOrganizationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        settings: expect.objectContaining({
          governance: {
            defaultPack: { packId: 'sovereign-core', version: '2026.04' },
            familyPacks: {
              privacy: { packId: 'enterprise-privacy', version: '2026.04' },
            },
          },
        }),
      }),
    }));
  });

  it('auto-selects the only organization membership when resolving context', async () => {
    mockOrganizationMemberFindMany.mockResolvedValue([
      {
        organizationId: 'org-1',
        identityId: 'identity-1',
        role: 'admin',
        permissions: ['oidc:manage'],
        invitedAt: new Date('2026-04-21T00:00:00.000Z'),
        joinedAt: new Date('2026-04-21T00:00:00.000Z'),
        organization: {
          id: 'org-1',
          name: 'ZeroID Sovereign Lab',
          plan: 'enterprise',
          jurisdictions: ['UAE'],
          settings: {},
        },
      },
    ]);

    const context = await enterpriseOrganizationService.resolveContext('identity-1', undefined, ['admin']);
    expect(context.organizationId).toBe('org-1');
    expect(context.role).toBe('admin');
  });

  it('requires explicit organization selection when the identity belongs to multiple orgs', async () => {
    mockOrganizationMemberFindMany.mockResolvedValue([
      {
        organizationId: 'org-1',
        identityId: 'identity-1',
        role: 'admin',
        permissions: [],
        invitedAt: new Date('2026-04-21T00:00:00.000Z'),
        joinedAt: new Date('2026-04-21T00:00:00.000Z'),
        organization: {
          id: 'org-1',
          name: 'ZeroID Sovereign Lab',
          plan: 'enterprise',
          jurisdictions: ['UAE'],
          settings: {},
        },
      },
      {
        organizationId: 'org-2',
        identityId: 'identity-1',
        role: 'auditor',
        permissions: [],
        invitedAt: new Date('2026-04-22T00:00:00.000Z'),
        joinedAt: new Date('2026-04-22T00:00:00.000Z'),
        organization: {
          id: 'org-2',
          name: 'ZeroID Audit Office',
          plan: 'growth',
          jurisdictions: ['EU'],
          settings: {},
        },
      },
    ]);

    await expect(
      enterpriseOrganizationService.resolveContext('identity-1', undefined, ['admin', 'auditor']),
    ).rejects.toMatchObject<Partial<EnterpriseOrganizationError>>({
      code: 'ENTERPRISE_ORGANIZATION_SELECTION_REQUIRED',
      statusCode: 409,
    });
  });

  it('rejects access when the caller role is insufficient', async () => {
    mockOrganizationMemberFindMany.mockResolvedValue([
      {
        organizationId: 'org-1',
        identityId: 'identity-1',
        role: 'viewer',
        permissions: [],
        invitedAt: new Date('2026-04-21T00:00:00.000Z'),
        joinedAt: new Date('2026-04-21T00:00:00.000Z'),
        organization: {
          id: 'org-1',
          name: 'ZeroID Sovereign Lab',
          plan: 'enterprise',
          jurisdictions: ['UAE'],
          settings: {},
        },
      },
    ]);

    await expect(
      enterpriseOrganizationService.resolveContext('identity-1', 'org-1', ['admin']),
    ).rejects.toMatchObject<Partial<EnterpriseOrganizationError>>({
      code: 'ENTERPRISE_ROLE_FORBIDDEN',
      statusCode: 403,
    });
  });

  it('adds or updates an organization member for an active identity', async () => {
    const result = await enterpriseOrganizationService.addMember('org-1', {
      identityId: 'identity-2',
      role: 'operator',
      permissions: ['reports:read'],
    });

    expect(mockIdentityFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'identity-2' },
    }));
    expect(mockOrganizationMemberUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId_identityId: {
          organizationId: 'org-1',
          identityId: 'identity-2',
        },
      },
      create: expect.objectContaining({
        role: 'operator',
      }),
    }));
    expect(result.role).toBe('operator');
  });

  it('reads and updates organization governance settings', async () => {
    mockOrganizationFindUnique
      .mockResolvedValueOnce({
        id: 'org-1',
        settings: {
          governance: {
            defaultPack: { packId: 'baseline-core', version: '2026.04' },
          },
        },
      })
      .mockResolvedValueOnce({
        id: 'org-1',
        settings: {
          governance: {
            defaultPack: { packId: 'baseline-core', version: '2026.04' },
          },
        },
      });

    const current = await enterpriseOrganizationService.getGovernanceSettings('org-1');
    expect(current).toEqual({
      defaultPack: { packId: 'baseline-core', version: '2026.04' },
    });

    const updated = await enterpriseOrganizationService.updateGovernanceSettings(
      'org-1',
      'identity-1',
      {
        defaultPack: { packId: 'sovereign-core', version: '2026.04' },
        familyPacks: {
          privacy: { packId: 'enterprise-privacy', version: '2026.04' },
        },
        changeReason: 'Move privacy workflows onto sovereign governance baseline',
      },
    );

    expect(mockOrganizationUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'org-1' },
      data: expect.objectContaining({
        settings: expect.objectContaining({
          governance: expect.objectContaining({
            defaultPack: { packId: 'sovereign-core', version: '2026.04' },
            familyPacks: {
              privacy: { packId: 'enterprise-privacy', version: '2026.04' },
            },
          }),
        }),
      }),
    }));
    expect(updated).toEqual({
      defaultPack: { packId: 'sovereign-core', version: '2026.04' },
      familyPacks: {
        privacy: { packId: 'enterprise-privacy', version: '2026.04' },
      },
      lastUpdatedAt: '2026-04-21T00:00:00.000Z',
      lastUpdatedByIdentityId: 'identity-1',
      changeHistory: [
        {
          changedAt: '2026-04-21T00:00:00.000Z',
          changedByIdentityId: 'identity-1',
          changeReason: 'Move privacy workflows onto sovereign governance baseline',
          defaultPack: { packId: 'sovereign-core', version: '2026.04' },
          familyPacks: {
            privacy: { packId: 'enterprise-privacy', version: '2026.04' },
          },
        },
      ],
    });
    expect(mockAuditLogCreate).toHaveBeenCalled();
  });

  it('rejects unknown governance packs during governance updates', async () => {
    await expect(
      enterpriseOrganizationService.updateGovernanceSettings('org-1', 'identity-1', {
        defaultPack: { packId: 'unknown-pack', version: '2026.04' },
      }),
    ).rejects.toMatchObject<Partial<EnterpriseOrganizationError>>({
      code: 'ENTERPRISE_GOVERNANCE_PACK_INVALID',
      statusCode: 400,
    });
    expect(mockOrganizationUpdate).not.toHaveBeenCalled();
  });
});
