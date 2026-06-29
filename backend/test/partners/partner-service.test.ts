import {
  walletEligibility,
  poolEligibility,
  poolAgentScan,
  initiateWalletDisclosure,
  getPartnerEvidence,
  PartnerError,
  type PartnerDeps,
} from '@/services/partners/partner-service';

const ALLOWED = { status: 'ALLOWED', decisionId: 'dec1' } as never;
const DENIED = { status: 'DENIED', decisionId: 'dec2' } as never;

function makeDeps(over: Partial<PartnerDeps> = {}): PartnerDeps {
  return {
    resolveIdentity: jest.fn().mockResolvedValue({ id: 'i1', did: 'did:owner' }),
    runEligibility: jest.fn().mockResolvedValue(ALLOWED),
    runAgentScan: jest.fn().mockResolvedValue({ status: 'ALLOWED', decisionId: 'd', actor: {} } as never),
    recordDisclosureRequest: jest.fn().mockResolvedValue('escrow-1'),
    getEvidence: jest.fn().mockResolvedValue({ auditLogId: 'a1' }),
    ...over,
  };
}

describe('walletEligibility', () => {
  it('resolves the owner identity and runs eligibility (eligible)', async () => {
    const deps = makeDeps();
    const res = await walletEligibility(deps, {
      ownerDid: 'did:owner', credentialId: 'c1', policyId: 'P', relyingAppId: 'wallet',
    });
    expect(deps.runEligibility).toHaveBeenCalledWith(
      { id: 'i1', did: 'did:owner' },
      expect.objectContaining({ subjectDid: 'did:owner', policyId: 'P' }),
    );
    expect(res.eligible).toBe(true);
  });

  it('returns eligible=false on a DENIED decision', async () => {
    const deps = makeDeps({ runEligibility: jest.fn().mockResolvedValue(DENIED) });
    const res = await walletEligibility(deps, {
      ownerDid: 'did:owner', credentialId: 'c1', policyId: 'P', relyingAppId: 'wallet',
    });
    expect(res.eligible).toBe(false);
  });

  it('throws OWNER_NOT_FOUND when the identity is unknown', async () => {
    const deps = makeDeps({ resolveIdentity: jest.fn().mockResolvedValue(null) });
    await expect(
      walletEligibility(deps, { ownerDid: 'did:x', credentialId: 'c', policyId: 'P', relyingAppId: 'w' }),
    ).rejects.toMatchObject({ code: 'OWNER_NOT_FOUND', statusCode: 404 });
  });
});

describe('poolEligibility', () => {
  it('checks the staker under the pool policy and echoes poolId', async () => {
    const deps = makeDeps({ resolveIdentity: jest.fn().mockResolvedValue({ id: 'i2', did: 'did:staker' }) });
    const res = await poolEligibility(deps, {
      poolId: 'pool-7', stakerDid: 'did:staker', credentialId: 'c1', policyId: 'POOL_P', relyingAppId: 'cruzible',
    });
    expect(res.poolId).toBe('pool-7');
    expect(res.eligible).toBe(true);
    expect(deps.runEligibility).toHaveBeenCalledWith(
      { id: 'i2', did: 'did:staker' },
      expect.objectContaining({ subjectDid: 'did:staker', policyId: 'POOL_P' }),
    );
  });

  it('throws STAKER_NOT_FOUND when unknown', async () => {
    const deps = makeDeps({ resolveIdentity: jest.fn().mockResolvedValue(null) });
    await expect(
      poolEligibility(deps, { poolId: 'p', stakerDid: 'x', credentialId: 'c', policyId: 'P', relyingAppId: 'c' }),
    ).rejects.toMatchObject({ code: 'STAKER_NOT_FOUND', statusCode: 404 });
  });
});

describe('poolAgentScan', () => {
  it('delegates to the AI Agent Passport scan and echoes poolId', async () => {
    const runAgentScan = jest.fn().mockResolvedValue({ status: 'ALLOWED', decisionId: 'd', actor: {} } as never);
    const deps = makeDeps({ runAgentScan });
    const res = await poolAgentScan(deps, {
      poolId: 'pool-7', agentDid: 'did:agent', controllerDid: 'did:ctrl', subjectDid: 'did:ctrl',
      credentialId: 'c1', policyId: 'P', relyingAppId: 'cruzible',
    });
    expect(runAgentScan).toHaveBeenCalledWith(
      expect.objectContaining({ agentDid: 'did:agent', controllerDid: 'did:ctrl' }),
    );
    expect(res.poolId).toBe('pool-7');
    expect(res.status).toBe('ALLOWED');
  });
});

describe('initiateWalletDisclosure', () => {
  it('records a warrant-bound request and returns the envelope', async () => {
    const deps = makeDeps();
    const res = await initiateWalletDisclosure(deps, { decisionId: 'dec1', warrantHash: '0xwarrant' });
    expect(deps.recordDisclosureRequest).toHaveBeenCalledWith({ decisionId: 'dec1', warrantHash: '0xwarrant' });
    expect(res).toEqual({ escrowId: 'escrow-1', warrantHash: '0xwarrant', status: 'REQUESTED' });
  });
});

describe('getPartnerEvidence', () => {
  it('returns the evidence bundle', async () => {
    const deps = makeDeps();
    await expect(getPartnerEvidence(deps, 'dec1')).resolves.toEqual({ auditLogId: 'a1' });
  });
  it('throws EVIDENCE_NOT_FOUND when absent', async () => {
    const deps = makeDeps({ getEvidence: jest.fn().mockResolvedValue(null) });
    await expect(getPartnerEvidence(deps, 'missing')).rejects.toMatchObject({
      code: 'EVIDENCE_NOT_FOUND', statusCode: 404,
    });
  });

  it('exposes PartnerError as a typed error', () => {
    const e = new PartnerError('x', 'OWNER_NOT_FOUND', 404);
    expect(e.code).toBe('OWNER_NOT_FOUND');
    expect(e.statusCode).toBe(404);
  });
});
