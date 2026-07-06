import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EligibilityPage from '../page';

jest.mock('@/components/layout/AppLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

jest.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, prop: string) => {
        return React.forwardRef((props: any, ref: any) => {
          const { initial, animate, transition, ...rest } = props;
          const Tag = prop as any;
          return <Tag ref={ref} {...rest} />;
        });
      },
    },
  ),
}));

const receipt = {
  status: 'ALLOWED',
  decisionId: 'dec_testdecision',
  policyId:
    'zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1',
  policyVersion: '2026.06.1',
  subjectDid: 'did:aethelred:mainnet:0x8f4c2a1d6e7b9012cafe',
  credentialId: 'cred_kyc_v1_ae_000184',
  relyingAppId: 'edge-secure-data-room',
  proof: {
    proofId: 'zkp_testproof',
    circuitId: 'zkc_eligibility_policy_context_v1',
    circuitName: 'eligibility_policy_context_v1',
    verificationKeyId: 'vk_eligibility_policy_context_v1_2026_06_27',
    manifestDigest:
      '0x1f48ddf10a370c1ab6af80f17e359f0c00700b5151a7ee1db835dfdb3cde25e5',
    policyBindingDigest:
      '0xc339f81323c5288c23a30a0fcbc3140bdb60f79193101cbc8ee0fc42eda45e0c',
    contextHash:
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    verifiedAt: '2026-06-23T10:00:00.000Z',
    publicSignals: {},
    privateInputsRedacted: ['dobYear'],
    disclosurePolicy: {
      rawFieldsDisclosed: [],
      publicSignals: [
        'ageThresholdYears',
        'residencyCountryCode',
        'claimsHash',
        'currentTimestamp',
        'policyVersionHash',
        'contextCommitment',
      ],
      provedPredicates: [
        'AGE_OVER_THRESHOLD',
        'RESIDENCY_ALLOWED',
        'SANCTIONS_CLEAR',
        'NON_REVOCATION_CHECKED',
        'TEE_ATTESTED',
      ],
      privateInputsRedacted: ['dobYear'],
      disclosureBudget: {
        rawFieldCount: 0,
        publicSignalCount: 6,
        provedPredicateCount: 5,
        redactedPrivateInputCount: 1,
      },
    },
  },
  evaluation: {
    ageOverThreshold: true,
    residencyAllowed: true,
    nationalityAllowed: true,
    sanctionsClear: true,
    riskAccepted: true,
    credentialActive: true,
    credentialNotExpired: true,
    nonRevocationChecked: true,
    onchainAttested: true,
    teeAttested: true,
    minimumAge: 21,
    computedAge: 33,
    allowedResidencies: ['AE'],
    deniedReasons: [],
  },
  evidence: {
    auditLogId: 'aud_test',
    auditHash:
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    regulatoryReportId: 'reg_test',
    teeAttestationId: 'tee_sgx_uae_issuer_node_7f12a9',
    receiptHash:
      '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    receiptHashAlgorithm: 'sha256-canonical-json-v1',
    policyRegistry: 'zeroid://policy-registry/core/regulated-digital-services',
    artifactDigest:
      '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    manifestPath: 'circuits/manifest/eligibility_v1.json',
    manifestDigest:
      '0x1f48ddf10a370c1ab6af80f17e359f0c00700b5151a7ee1db835dfdb3cde25e5',
    sourceDigest:
      '0xac4d4468fd32692373b5a5942a94588120bfbbda82b151da8aa92a12fd6393e3',
    policyBindingDigest:
      '0xc339f81323c5288c23a30a0fcbc3140bdb60f79193101cbc8ee0fc42eda45e0c',
    artifactStatus: 'SOURCE_VALIDATED_ARTIFACTS_PENDING',
    evidenceChain: ['issuer_proof', 'tee', 'vk', 'audit'],
  },
  issuedAt: '2026-06-23T10:00:00.000Z',
};

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: receipt }),
  });
  (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
});

describe('EligibilityPage', () => {
  it('renders the enterprise eligibility proof command center', async () => {
    render(<EligibilityPage />);

    expect(screen.getByTestId('app-layout')).toBeInTheDocument();
    expect(
      screen.getByText('Eligibility proof command center'),
    ).toBeInTheDocument();
    expect(screen.getByText('EDGE Secure Data Room')).toBeInTheDocument();
    expect(screen.getByText('Presight Analytics Mesh')).toBeInTheDocument();
    expect(screen.getByText('TII Research Sandbox')).toBeInTheDocument();
    expect(await screen.findByText('ALLOWED')).toBeInTheDocument();
    expect(screen.getByText('Disclosure policy')).toBeInTheDocument();
    expect(screen.getByText('Raw fields disclosed')).toBeInTheDocument();
  });

  it('runs the proof with the selected relying app context', async () => {
    render(<EligibilityPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Presight Analytics Mesh'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, init] = fetchMock.mock.calls[1];
    const body = JSON.parse(init.body);
    expect(body.relyingAppId).toBe('presight-analytics-mesh');
    expect(body.contextNonce).toContain('presight-analytics-mesh');
  });

  it('exposes the request contract in the evidence console', async () => {
    render(<EligibilityPage />);
    await screen.findByText('ALLOWED');

    fireEvent.click(screen.getByText('Request'));

    expect(screen.getByText(/"subjectDid"/)).toBeInTheDocument();
    expect(screen.getByText(/"policyId"/)).toBeInTheDocument();
  });

  it('sends assurance toggle values in the proof request', async () => {
    render(<EligibilityPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText(/Require on-chain attestation/));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, init] = fetchMock.mock.calls[1];
    const body = JSON.parse(init.body);
    expect(body.options.requireOnchainAttestation).toBe(true);
  });
});
