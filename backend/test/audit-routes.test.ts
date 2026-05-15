import express from 'express';
import request from 'supertest';

const mockAuditFindUnique = jest.fn();
const mockAuditFindMany = jest.fn();
const mockAuditCount = jest.fn();
const mockAuditCreate = jest.fn();
const mockCredentialFindUnique = jest.fn();

jest.mock('../src/middleware/rateLimit', () => ({
  apiRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../src/index', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  prisma: {
    auditLog: {
      findUnique: mockAuditFindUnique,
      findMany: mockAuditFindMany,
      count: mockAuditCount,
      create: mockAuditCreate,
      findFirst: jest.fn(),
    },
    credential: {
      findUnique: mockCredentialFindUnique,
    },
    schemaGovernance: {
      findUnique: jest.fn(),
    },
    verification: {
      findUnique: jest.fn(),
    },
  },
}));

import { auditRoutes } from '../src/routes/audit';

const AUDIT_ID = '11111111-1111-4111-8111-111111111111';
const CREDENTIAL_ID = '22222222-2222-4222-8222-222222222222';

function createApp(identityId = 'viewer-1') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).identity = {
      id: identityId,
      did: `did:aethelred:test:${identityId}`,
      publicKey: 'pub',
      status: 'ACTIVE',
    };
    next();
  });
  app.use('/audit', auditRoutes);
  return app;
}

describe('audit route access control', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuditFindUnique.mockResolvedValue({
      id: AUDIT_ID,
      identityId: null,
      action: 'CREDENTIAL_VERIFIED',
      resourceType: 'credential',
      resourceId: CREDENTIAL_ID,
      details: { valid: true },
      timestamp: new Date('2026-04-21T00:00:00.000Z'),
    });
    mockAuditFindMany.mockResolvedValue([]);
    mockAuditCount.mockResolvedValue(0);
    mockAuditCreate.mockResolvedValue({});
  });

  it('hides identity-less audit logs when the caller cannot access the resource', async () => {
    mockCredentialFindUnique.mockResolvedValue({
      issuerId: 'issuer-1',
      subjectId: 'subject-1',
    });

    await request(createApp('viewer-9'))
      .get(`/audit/${AUDIT_ID}`)
      .expect(404);
  });

  it('allows identity-less audit logs when the caller owns the audited resource', async () => {
    mockCredentialFindUnique.mockResolvedValue({
      issuerId: 'issuer-1',
      subjectId: 'viewer-9',
    });

    const response = await request(createApp('viewer-9'))
      .get(`/audit/${AUDIT_ID}`)
      .expect(200);

    expect(response.body.data).toMatchObject({
      id: AUDIT_ID,
      resourceType: 'credential',
      resourceId: CREDENTIAL_ID,
    });
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          identityId: 'viewer-9',
          action: 'AUDIT_LOG_ACCESSED',
          resourceType: 'audit_log',
          resourceId: AUDIT_ID,
          details: expect.objectContaining({
            operation: 'read',
            targetResourceType: 'credential',
            accessedViaResourceAccess: true,
          }),
        }),
      }),
    );
  });

  it('records audit exports before returning evidence', async () => {
    mockAuditFindMany.mockResolvedValue([
      {
        id: AUDIT_ID,
        identityId: 'viewer-9',
        action: 'CREDENTIAL_VERIFIED',
        resourceType: 'credential',
        resourceId: CREDENTIAL_ID,
        timestamp: new Date('2026-04-21T00:00:00.000Z'),
      },
    ]);

    await request(createApp('viewer-9'))
      .get('/audit/export/download')
      .query({
        from: '2026-04-01T00:00:00.000Z',
        to: '2026-04-30T00:00:00.000Z',
      })
      .expect(200);

    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          identityId: 'viewer-9',
          action: 'AUDIT_LOG_EXPORTED',
          resourceType: 'audit_export',
          resourceId: 'viewer-9',
          details: expect.objectContaining({
            operation: 'export',
            format: 'json',
            totalRecords: 1,
          }),
        }),
      }),
    );
  });
});
