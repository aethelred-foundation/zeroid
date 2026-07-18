import {
  AGENT_ELIGIBILITY_UNAVAILABLE_CODE,
  AgentEligibilityError,
  agentEligibilityProof,
  type AgentEligibilityDeps,
  type AgentEligibilityProofRequest,
} from '@/services/ai/agent-eligibility';

function makeDeps(): AgentEligibilityDeps {
  return {
    loadAgent: jest.fn(),
    loadController: jest.fn(),
    runEligibility: jest.fn(),
    recordAgentAction: jest.fn(),
    idempotencyStore: {
      get: jest.fn(),
      set: jest.fn(),
    },
  };
}

const request: AgentEligibilityProofRequest = {
  agentDid: 'did:aethelred:agent',
  controllerDid: 'did:aethelred:controller',
  subjectDid: 'did:aethelred:controller',
  credentialId: 'credential-1',
  policyId: 'POLICY_REGULATED_SERVICE_18PLUS_V1',
  relyingAppId: 'cruzible',
  contextNonce: 'untrusted-request-nonce',
  idempotencyKey: 'attempt-1',
};

describe('agentEligibilityProof', () => {
  it('fails closed before treating credential state or a human session as agent authorization', async () => {
    const deps = makeDeps();

    await expect(agentEligibilityProof(deps, request)).rejects.toMatchObject({
      code: AGENT_ELIGIBILITY_UNAVAILABLE_CODE,
      statusCode: 503,
    });

    expect(deps.loadAgent).not.toHaveBeenCalled();
    expect(deps.loadController).not.toHaveBeenCalled();
    expect(deps.runEligibility).not.toHaveBeenCalled();
    expect(deps.recordAgentAction).not.toHaveBeenCalled();
    expect(deps.idempotencyStore?.get).not.toHaveBeenCalled();
    expect(deps.idempotencyStore?.set).not.toHaveBeenCalled();
  });

  it('keeps the typed error contract for callers', () => {
    const error = new AgentEligibilityError('unavailable', 'TEST_CODE', 503);
    expect(error.code).toBe('TEST_CODE');
    expect(error.statusCode).toBe(503);
  });
});
