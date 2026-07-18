import express from 'express';
import request from 'supertest';

const mockIdem = { findUnique: jest.fn(), upsert: jest.fn() };
jest.mock('../../src/runtime', () => ({
  prisma: {
    idempotencyRecord: {
      findUnique: (...a: unknown[]) => mockIdem.findUnique(...a),
      upsert: (...a: unknown[]) => mockIdem.upsert(...a),
    },
  },
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));
jest.mock('../../src/middleware/auth', () => ({
  authMiddleware: (req: any, _res: unknown, next: () => void) => {
    req.identity = { id: 'p1', did: 'did:partner', status: 'ACTIVE' };
    next();
  },
}));
jest.mock('../../src/middleware/rateLimit', () => ({
  apiRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
// Avoid dragging in the verification/agent route modules transitively.
jest.mock('../../src/services/eligibility-invoker', () => ({ invokeEligibility: jest.fn() }));
jest.mock('../../src/services/ai/agent-eligibility', () => ({
  agentEligibilityProof: jest.fn(),
  AgentEligibilityError: class extends Error {},
}));
jest.mock('../../src/routes/ai/agent-eligibility', () => ({ buildAgentEligibilityDeps: jest.fn() }));

const mockSvc = {
  walletEligibility: jest.fn(),
  poolEligibility: jest.fn(),
  poolAgentScan: jest.fn(),
  initiateWalletDisclosure: jest.fn(),
  getPartnerEvidence: jest.fn(),
};
jest.mock('../../src/services/partners/partner-service', () => ({
  walletEligibility: (...a: unknown[]) => mockSvc.walletEligibility(...a),
  poolEligibility: (...a: unknown[]) => mockSvc.poolEligibility(...a),
  poolAgentScan: (...a: unknown[]) => mockSvc.poolAgentScan(...a),
  initiateWalletDisclosure: (...a: unknown[]) => mockSvc.initiateWalletDisclosure(...a),
  getPartnerEvidence: (...a: unknown[]) => mockSvc.getPartnerEvidence(...a),
}));

import partnersRouter from '../../src/routes/partners';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/partners', partnersRouter);
  return app;
}

beforeEach(() => {
  Object.values(mockSvc).forEach((f) => f.mockReset());
  mockIdem.findUnique.mockReset();
  mockIdem.upsert.mockReset().mockResolvedValue(undefined);
});

describe('partner routes', () => {
  it('POST /wallet/eligibility → 200', async () => {
    mockSvc.walletEligibility.mockResolvedValue({ eligible: true, decision: { status: 'ALLOWED' } });
    const r = await request(makeApp())
      .post('/api/v1/partners/wallet/eligibility')
      .send({ ownerDid: 'did:o', credentialId: 'c', policyId: 'P', relyingAppId: 'w' });
    expect(r.status).toBe(200);
    expect(r.body.eligible).toBe(true);
  });

  it('maps a service error code→status', async () => {
    mockSvc.walletEligibility.mockRejectedValue(
      Object.assign(new Error('no owner'), { code: 'OWNER_NOT_FOUND', statusCode: 404 }),
    );
    const r = await request(makeApp())
      .post('/api/v1/partners/wallet/eligibility')
      .send({ ownerDid: 'did:o', credentialId: 'c', policyId: 'P', relyingAppId: 'w' });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('OWNER_NOT_FOUND');
  });

  it('returns 400 on an invalid body', async () => {
    const r = await request(makeApp())
      .post('/api/v1/partners/wallet/eligibility')
      .send({ ownerDid: 'did:o' });
    expect(r.status).toBe(400);
    expect(mockSvc.walletEligibility).not.toHaveBeenCalled();
  });

  it('POST /cruzible/pools/:poolId/eligibility → 200 with poolId', async () => {
    mockSvc.poolEligibility.mockResolvedValue({ poolId: 'pool-7', eligible: true, decision: {} });
    const r = await request(makeApp())
      .post('/api/v1/partners/cruzible/pools/pool-7/eligibility')
      .send({ stakerDid: 'did:s', credentialId: 'c', policyId: 'P', relyingAppId: 'cr' });
    expect(r.status).toBe(200);
    expect(r.body.poolId).toBe('pool-7');
    expect(mockSvc.poolEligibility).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ poolId: 'pool-7', stakerDid: 'did:s' }),
    );
  });

  it('POST /cruzible/pools/:poolId/agent-scan → 200', async () => {
    mockSvc.poolAgentScan.mockResolvedValue({ poolId: 'pool-7', status: 'ALLOWED' });
    const r = await request(makeApp())
      .post('/api/v1/partners/cruzible/pools/pool-7/agent-scan')
      .send({
        agentDid: 'did:a', controllerDid: 'did:c', subjectDid: 'did:c',
        credentialId: 'c', policyId: 'P', relyingAppId: 'cr',
      });
    expect(r.status).toBe(200);
  });

  it('POST /wallet/disclosure → 202 REQUESTED', async () => {
    mockSvc.initiateWalletDisclosure.mockResolvedValue({
      escrowId: '0xabc', warrantHash: '0xw', status: 'REQUESTED',
    });
    const r = await request(makeApp())
      .post('/api/v1/partners/wallet/disclosure')
      .send({ decisionId: 'dec1', warrantHash: '0xw' });
    expect(r.status).toBe(202);
    expect(r.body.status).toBe('REQUESTED');
  });

  it('GET /wallet/evidence/:decisionId → 200', async () => {
    mockSvc.getPartnerEvidence.mockResolvedValue({ auditLogId: 'a1' });
    const r = await request(makeApp()).get('/api/v1/partners/wallet/evidence/dec1');
    expect(r.status).toBe(200);
    expect(r.body.auditLogId).toBe('a1');
  });

  describe('idempotency', () => {
    it('returns the cached body on a repeated Idempotency-Key without re-running the service', async () => {
      const cached = { eligible: true, decision: { status: 'ALLOWED' } };
      mockIdem.findUnique.mockResolvedValue({ response: cached });
      const r = await request(makeApp())
        .post('/api/v1/partners/wallet/eligibility')
        .set('Idempotency-Key', 'k1')
        .send({ ownerDid: 'did:o', credentialId: 'c', policyId: 'P', relyingAppId: 'w' });
      expect(r.status).toBe(200);
      expect(r.body.eligible).toBe(true);
      expect(mockIdem.findUnique).toHaveBeenCalledWith({
        where: { key: 'partner.wallet.eligibility:k1' },
      });
      expect(mockSvc.walletEligibility).not.toHaveBeenCalled();
    });

    it('runs the service and records the result on a fresh Idempotency-Key', async () => {
      mockIdem.findUnique.mockResolvedValue(null);
      mockSvc.walletEligibility.mockResolvedValue({ eligible: true, decision: {} });
      const r = await request(makeApp())
        .post('/api/v1/partners/wallet/eligibility')
        .set('Idempotency-Key', 'k2')
        .send({ ownerDid: 'did:o', credentialId: 'c', policyId: 'P', relyingAppId: 'w' });
      expect(r.status).toBe(200);
      expect(mockSvc.walletEligibility).toHaveBeenCalledTimes(1);
      expect(mockIdem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: 'partner.wallet.eligibility:k2' } }),
      );
    });

    it('rejects a malformed Idempotency-Key with 400 before running the service', async () => {
      const r = await request(makeApp())
        .post('/api/v1/partners/wallet/eligibility')
        .set('Idempotency-Key', 'x'.repeat(300))
        .send({ ownerDid: 'did:o', credentialId: 'c', policyId: 'P', relyingAppId: 'w' });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('INVALID_IDEMPOTENCY_KEY');
      expect(mockSvc.walletEligibility).not.toHaveBeenCalled();
      expect(mockIdem.findUnique).not.toHaveBeenCalled();
    });
  });
});
