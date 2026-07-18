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
    principal: { id: 'i1', did: 'did:owner' },
    resolveIdentity: jest.fn().mockResolvedValue({ id: 'i1', did: 'did:owner' }),
    runEligibility: jest.fn().mockResolvedValue(ALLOWED),
    runAgentScan: jest.fn().mockResolvedValue({ status: 'ALLOWED', decisionId: 'd', actor: {} } as never),
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
    const deps = makeDeps({
      principal: { id: 'ix', did: 'did:x' },
      resolveIdentity: jest.fn().mockResolvedValue(null),
    });
    await expect(
      walletEligibility(deps, { ownerDid: 'did:x', credentialId: 'c', policyId: 'P', relyingAppId: 'w' }),
    ).rejects.toMatchObject({ code: 'OWNER_NOT_FOUND', statusCode: 404 });
  });

  it('rejects an owner DID that does not belong to the caller', async () => {
    const deps = makeDeps();
    await expect(
      walletEligibility(deps, {
        ownerDid: 'did:someone-else', credentialId: 'c', policyId: 'P', relyingAppId: 'w',
      }),
    ).rejects.toMatchObject({
      code: 'PARTNER_PRINCIPAL_MISMATCH', statusCode: 403,
    });
    expect(deps.resolveIdentity).not.toHaveBeenCalled();
  });
});

describe('poolEligibility', () => {
  it('checks the staker under the pool policy and echoes poolId', async () => {
    const deps = makeDeps({
      principal: { id: 'i2', did: 'did:staker' },
      resolveIdentity: jest.fn().mockResolvedValue({ id: 'i2', did: 'did:staker' }),
    });
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
    const deps = makeDeps({
      principal: { id: 'i2', did: 'x' },
      resolveIdentity: jest.fn().mockResolvedValue(null),
    });
    await expect(
      poolEligibility(deps, { poolId: 'p', stakerDid: 'x', credentialId: 'c', policyId: 'P', relyingAppId: 'c' }),
    ).rejects.toMatchObject({ code: 'STAKER_NOT_FOUND', statusCode: 404 });
  });
});

describe('poolAgentScan', () => {
  it('delegates to the AI Agent Passport scan and echoes poolId', async () => {
    const runAgentScan = jest.fn().mockResolvedValue({ status: 'ALLOWED', decisionId: 'd', actor: {} } as never);
    const deps = makeDeps({
      principal: { id: 'i-controller', did: 'did:ctrl' },
      runAgentScan,
    });
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

  it('rejects agent scans for another controller or subject', async () => {
    const runAgentScan = jest.fn();
    const deps = makeDeps({
      principal: { id: 'i-controller', did: 'did:ctrl' },
      runAgentScan,
    });
    await expect(
      poolAgentScan(deps, {
        poolId: 'pool-7', agentDid: 'did:agent', controllerDid: 'did:other',
        subjectDid: 'did:ctrl', credentialId: 'c1', policyId: 'P', relyingAppId: 'cruzible',
      }),
    ).rejects.toMatchObject({ code: 'PARTNER_PRINCIPAL_MISMATCH', statusCode: 403 });
    await expect(
      poolAgentScan(deps, {
        poolId: 'pool-7', agentDid: 'did:agent', controllerDid: 'did:ctrl',
        subjectDid: 'did:other', credentialId: 'c1', policyId: 'P', relyingAppId: 'cruzible',
      }),
    ).rejects.toMatchObject({ code: 'PARTNER_PRINCIPAL_MISMATCH', statusCode: 403 });
    expect(runAgentScan).not.toHaveBeenCalled();
  });
});

describe('initiateWalletDisclosure', () => {
  it('fails honestly until a persisted quorum escrow is configured', async () => {
    const deps = makeDeps();
    await expect(
      initiateWalletDisclosure(deps, { decisionId: 'dec1', warrantHash: '0xwarrant' }),
    ).rejects.toMatchObject({ code: 'DISCLOSURE_UNAVAILABLE', statusCode: 501 });
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
