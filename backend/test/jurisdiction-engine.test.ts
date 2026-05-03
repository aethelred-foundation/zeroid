import { JurisdictionEngine } from '../src/services/compliance/jurisdiction-engine';

describe('JurisdictionEngine credential validity enforcement', () => {
  let engine: JurisdictionEngine;

  beforeEach(() => {
    engine = new JurisdictionEngine();
  });

  it('fails compliance when a required credential is expired', async () => {
    const now = Date.now();
    const [result] = await engine.evaluateCompliance({
      entityId: 'entity-1',
      entityType: 'individual',
      jurisdictions: ['AE-CBUAE'],
      operationType: 'transaction',
      credentials: [
        {
          credentialType: 'kyc_basic',
          issuerId: 'issuer-ae',
          issuingJurisdiction: 'AE-CBUAE',
          claims: { consent_given: true },
          issuedAt: new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString(),
          expiresAt: new Date(now - 60 * 1000).toISOString(),
        },
        {
          credentialType: 'aml_clearance',
          issuerId: 'issuer-ae',
          issuingJurisdiction: 'AE-CBUAE',
          claims: {},
          issuedAt: new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString(),
          expiresAt: new Date(now + 90 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
    });

    expect(result.overallStatus).toBe('non_compliant');
    expect(result.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Credential Validity Window',
          status: 'fail',
          detail: expect.stringContaining('kyc_basic:expired'),
        }),
      ]),
    );
    expect(result.missingCredentials).toEqual([]);
  });

  it('fails compliance when a credential issuance time is in the future', async () => {
    const now = Date.now();
    const [result] = await engine.evaluateCompliance({
      entityId: 'entity-2',
      entityType: 'individual',
      jurisdictions: ['US-FINCEN'],
      operationType: 'transaction',
      credentials: [
        {
          credentialType: 'kyc_basic',
          issuerId: 'issuer-us',
          issuingJurisdiction: 'US-FINCEN',
          claims: {},
          issuedAt: new Date(now + 10 * 60 * 1000).toISOString(),
          expiresAt: new Date(now + 90 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          credentialType: 'ctr_clearance',
          issuerId: 'issuer-us',
          issuingJurisdiction: 'US-FINCEN',
          claims: {},
          issuedAt: new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString(),
          expiresAt: new Date(now + 90 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
    });

    expect(result.overallStatus).toBe('non_compliant');
    expect(result.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Credential Validity Window',
          status: 'fail',
          detail: expect.stringContaining('kyc_basic:future_issued'),
        }),
      ]),
    );
    expect(result.missingCredentials).toEqual([]);
  });
});
