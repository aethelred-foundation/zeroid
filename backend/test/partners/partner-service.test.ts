import {
  walletEligibility,
  poolEligibility,
  poolAgentScan,
  initiateWalletDisclosure,
  getPartnerEvidence,
  PARTNER_ELIGIBILITY_CHALLENGE_UNAVAILABLE_CODE,
  PARTNER_ELIGIBILITY_EVIDENCE_UNAVAILABLE_CODE,
  PartnerError,
  type PartnerDeps,
} from '@/services/partners/partner-service';
import { AGENT_ELIGIBILITY_UNAVAILABLE_CODE } from '@/services/ai/agent-eligibility';

function backendUnavailable() {
  return Object.assign(new Error('Signed witness prover is not integrated'), {
    code: 'ZK_ELIGIBILITY_PROVER_NOT_INTEGRATED',
    statusCode: 503,
  });
}

function makeDeps(over: Partial<PartnerDeps> = {}): PartnerDeps {
  return {
    principal: { id: 'i1', did: 'did:owner' },
    resolveIdentity: jest
      .fn()
      .mockResolvedValue({ id: 'i1', did: 'did:owner' }),
    runEligibility: jest.fn().mockRejectedValue(backendUnavailable()),
    ...over,
  };
}

describe('walletEligibility', () => {
  it('propagates the authoritative backend 503 unchanged', async () => {
    const deps = makeDeps();

    await expect(
      walletEligibility(deps, {
        ownerDid: 'did:owner',
        credentialId: 'credential-1',
        policyId: 'POLICY_REGULATED_SERVICE_18PLUS_V1',
        relyingAppId: 'wallet',
      }),
    ).rejects.toMatchObject({
      code: 'ZK_ELIGIBILITY_PROVER_NOT_INTEGRATED',
      statusCode: 503,
    });
  });

  it('rejects an accidental decision until the durable RP challenge is integrated', async () => {
    const deps = makeDeps({
      runEligibility: jest.fn().mockResolvedValue({
        status: 'ALLOWED',
        decisionId: 'untrusted-decision',
      } as never),
    });

    await expect(
      walletEligibility(deps, {
        ownerDid: 'did:owner',
        credentialId: 'credential-1',
        policyId: 'POLICY_REGULATED_SERVICE_18PLUS_V1',
        relyingAppId: 'wallet',
      }),
    ).rejects.toMatchObject({
      code: PARTNER_ELIGIBILITY_CHALLENGE_UNAVAILABLE_CODE,
      statusCode: 503,
    });
  });

  it('rejects an owner DID that does not belong to the caller', async () => {
    const deps = makeDeps();
    await expect(
      walletEligibility(deps, {
        ownerDid: 'did:someone-else',
        credentialId: 'credential-1',
        policyId: 'policy-1',
        relyingAppId: 'wallet',
      }),
    ).rejects.toMatchObject({
      code: 'PARTNER_PRINCIPAL_MISMATCH',
      statusCode: 403,
    });
    expect(deps.resolveIdentity).not.toHaveBeenCalled();
    expect(deps.runEligibility).not.toHaveBeenCalled();
  });

  it('throws OWNER_NOT_FOUND before invoking eligibility for an unknown identity', async () => {
    const deps = makeDeps({
      resolveIdentity: jest.fn().mockResolvedValue(null),
    });
    await expect(
      walletEligibility(deps, {
        ownerDid: 'did:owner',
        credentialId: 'credential-1',
        policyId: 'policy-1',
        relyingAppId: 'wallet',
      }),
    ).rejects.toMatchObject({ code: 'OWNER_NOT_FOUND', statusCode: 404 });
    expect(deps.runEligibility).not.toHaveBeenCalled();
  });
});

describe('poolEligibility', () => {
  it('propagates the authoritative backend 503 unchanged', async () => {
    const deps = makeDeps({
      principal: { id: 'i2', did: 'did:staker' },
      resolveIdentity: jest.fn().mockResolvedValue({
        id: 'i2',
        did: 'did:staker',
      }),
    });

    await expect(
      poolEligibility(deps, {
        poolId: 'pool-7',
        stakerDid: 'did:staker',
        credentialId: 'credential-1',
        policyId: 'POOL_POLICY_V1',
        relyingAppId: 'cruzible',
      }),
    ).rejects.toMatchObject({
      code: 'ZK_ELIGIBILITY_PROVER_NOT_INTEGRATED',
      statusCode: 503,
    });
  });

  it('rejects an accidental pool decision until the durable RP challenge exists', async () => {
    const deps = makeDeps({
      principal: { id: 'i2', did: 'did:staker' },
      resolveIdentity: jest.fn().mockResolvedValue({
        id: 'i2',
        did: 'did:staker',
      }),
      runEligibility: jest
        .fn()
        .mockResolvedValue({ status: 'DENIED' } as never),
    });

    await expect(
      poolEligibility(deps, {
        poolId: 'pool-7',
        stakerDid: 'did:staker',
        credentialId: 'credential-1',
        policyId: 'POOL_POLICY_V1',
        relyingAppId: 'cruzible',
      }),
    ).rejects.toMatchObject({
      code: PARTNER_ELIGIBILITY_CHALLENGE_UNAVAILABLE_CODE,
      statusCode: 503,
    });
  });
});

describe('poolAgentScan', () => {
  it('is explicitly unavailable without agent challenge authentication and durable evidence', async () => {
    await expect(
      poolAgentScan(makeDeps(), {
        poolId: 'pool-7',
        agentDid: 'did:agent',
        controllerDid: 'did:owner',
        subjectDid: 'did:owner',
        credentialId: 'credential-1',
        policyId: 'POOL_POLICY_V1',
        relyingAppId: 'cruzible',
      }),
    ).rejects.toMatchObject({
      code: AGENT_ELIGIBILITY_UNAVAILABLE_CODE,
      statusCode: 503,
    });
  });
});

describe('initiateWalletDisclosure', () => {
  it('fails honestly until a persisted quorum escrow is configured', async () => {
    await expect(
      initiateWalletDisclosure(makeDeps(), {
        decisionId: 'decision-1',
        warrantHash: '0xwarrant',
      }),
    ).rejects.toMatchObject({
      code: 'DISCLOSURE_UNAVAILABLE',
      statusCode: 501,
    });
  });
});

describe('getPartnerEvidence', () => {
  it('does not expose raw audit details as verified eligibility evidence', async () => {
    await expect(
      getPartnerEvidence(makeDeps(), 'decision-1'),
    ).rejects.toMatchObject({
      code: PARTNER_ELIGIBILITY_EVIDENCE_UNAVAILABLE_CODE,
      statusCode: 503,
    });
  });

  it('keeps the typed partner error contract', () => {
    const error = new PartnerError('unavailable', 'TEST_CODE', 503);
    expect(error.code).toBe('TEST_CODE');
    expect(error.statusCode).toBe(503);
  });
});
