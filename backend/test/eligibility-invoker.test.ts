import { eligibilityProofHandler } from '../src/routes/verification';
import {
  EligibilityInvocationError,
  invokeEligibility,
} from '../src/services/eligibility-invoker';

jest.mock('../src/routes/verification', () => ({
  eligibilityProofHandler: jest.fn(),
}));

const mockedHandler = eligibilityProofHandler as jest.Mock;

const identity = { id: 'identity-1', did: 'did:aethelred:holder' };
const input = {
  subjectDid: identity.did,
  credentialId: 'credential-1',
  policyId: 'policy-1',
  relyingAppId: 'relying-app-1',
};

describe('invokeEligibility', () => {
  beforeEach(() => {
    mockedHandler.mockReset();
  });

  it('rejects a subject that is not the authenticated identity', async () => {
    await expect(
      invokeEligibility(identity, {
        ...input,
        subjectDid: 'did:aethelred:other',
      }),
    ).rejects.toMatchObject({
      code: 'CREDENTIAL_SUBJECT_MISMATCH',
      statusCode: 403,
    } satisfies Partial<EligibilityInvocationError>);
    expect(mockedHandler).not.toHaveBeenCalled();
  });

  it('propagates the authoritative backend 503 without manufacturing a decision', async () => {
    mockedHandler.mockImplementation(async (_req, res) => {
      res.status(503).json({
        error: 'Signed witness prover is not integrated',
        code: 'ZK_ELIGIBILITY_PROVER_NOT_INTEGRATED',
      });
    });

    await expect(invokeEligibility(identity, input)).rejects.toMatchObject({
      message: 'Signed witness prover is not integrated',
      code: 'ZK_ELIGIBILITY_PROVER_NOT_INTEGRATED',
      statusCode: 503,
    });
  });

  it('rejects an accidental upstream success until a durable RP challenge contract exists', async () => {
    mockedHandler.mockImplementation(async (_req, res) => {
      res.status(201).json({
        data: {
          status: 'ALLOWED',
          decisionId: 'untrusted-decision',
        },
      });
    });

    await expect(invokeEligibility(identity, input)).rejects.toMatchObject({
      code: 'PARTNER_ELIGIBILITY_CHALLENGE_UNAVAILABLE',
      statusCode: 503,
    });
  });

  it('maps malformed non-error upstream responses to a generic gateway failure', async () => {
    mockedHandler.mockImplementation(async (_req, res) => {
      res.status(200).json({ data: null });
    });

    await expect(invokeEligibility(identity, input)).rejects.toMatchObject({
      code: 'ELIGIBILITY_FAILED',
      statusCode: 502,
    });
  });
});
