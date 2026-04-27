import crypto from 'crypto';
import {
  createRegulatorySubmissionBundleSignature,
  verifyRegulatorySubmissionBundleSignature,
} from '../src/services/enterprise/regulatory-submission-signing';

const ORIGINAL_ENV = { ...process.env };

describe('regulatory submission signing service', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.REGULATORY_SUBMISSION_BUNDLE_SIGNING_SECRET__ORG__ORG_1__AUTHORITY__FSRA;
    delete process.env.REGULATORY_SUBMISSION_BUNDLE_SIGNING_PRIVATE_KEY__ORG__ORG_1__AUTHORITY__FSRA;
    delete process.env.REGULATORY_SUBMISSION_BUNDLE_SIGNING_PUBLIC_KEY__ORG__ORG_1__AUTHORITY__FSRA;
    delete process.env.REGULATORY_SUBMISSION_BUNDLE_SIGNING_ALGORITHM__ORG__ORG_1__AUTHORITY__FSRA;
    delete process.env.REGULATORY_SUBMISSION_BUNDLE_SIGNING_KEY_ID__ORG__ORG_1__AUTHORITY__FSRA;
    delete process.env.REGULATORY_SUBMISSION_BUNDLE_SIGNING_KEY_VERSION__ORG__ORG_1__AUTHORITY__FSRA;
    delete process.env.REGULATORY_SUBMISSION_BUNDLE_SIGNING_VERIFICATION_METHOD__ORG__ORG_1__AUTHORITY__FSRA;
    delete process.env.REGULATORY_SUBMISSION_BUNDLE_ALLOW_LOCAL_SIGNING;
    process.env.NODE_ENV = 'test';
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('creates and verifies a default asymmetric submission bundle signature', async () => {
    const digest = 'a'.repeat(64);
    const signature = await createRegulatorySubmissionBundleSignature(digest, {
      organizationId: 'org-1',
      authority: 'FSRA',
      filingJurisdiction: 'AE-ADGM',
    });

    expect(signature).toMatchObject({
      algorithm: 'EdDSA',
      keyId: 'org:org-1:authority:fsra',
      scope: 'organization_authority',
      encoding: 'base64url',
      keyVersion: 'dev-ed25519-1',
      verificationMethod: 'urn:zeroid:regulatory-submission:org:org-1:authority:fsra',
    });
    expect(signature.publicKeyFingerprint).toBeTruthy();
    expect(signature.publicKeyPem).toContain('BEGIN PUBLIC KEY');

    const verification = await verifyRegulatorySubmissionBundleSignature(digest, signature, {
      organizationId: 'org-1',
      authority: 'FSRA',
      filingJurisdiction: 'AE-ADGM',
    });

    expect(verification).toMatchObject({
      signatureValid: true,
      signingScopeMatched: true,
      verificationKeyMatched: true,
      signingAlgorithm: 'EdDSA',
      signingKeyId: 'org:org-1:authority:fsra',
      signingScope: 'organization_authority',
      signingKeyVersion: 'dev-ed25519-1',
      signingVerificationMethod: 'urn:zeroid:regulatory-submission:org:org-1:authority:fsra',
      issues: [],
    });
  });

  it('uses scoped HMAC fallback outside production when a scoped secret is configured', async () => {
    process.env.REGULATORY_SUBMISSION_BUNDLE_SIGNING_SECRET__ORG__ORG_1__AUTHORITY__FSRA = 'test-scoped-signing-secret-12345';

    const digest = 'b'.repeat(64);
    const signature = await createRegulatorySubmissionBundleSignature(digest, {
      organizationId: 'org-1',
      authority: 'FSRA',
      filingJurisdiction: 'AE-ADGM',
    });

    expect(signature).toMatchObject({
      algorithm: 'hmac-sha256',
      keyId: 'org:org-1:authority:fsra',
      scope: 'organization_authority',
      encoding: 'base64url',
    });
    expect(signature.publicKeyFingerprint).toBeUndefined();
    expect(signature.publicKeyPem).toBeUndefined();

    const verification = await verifyRegulatorySubmissionBundleSignature(digest, signature, {
      organizationId: 'org-1',
      authority: 'FSRA',
      filingJurisdiction: 'AE-ADGM',
    });

    expect(verification).toMatchObject({
      signatureValid: true,
      signingScopeMatched: true,
      verificationKeyMatched: true,
      signingAlgorithm: 'hmac-sha256',
      signingKeyId: 'org:org-1:authority:fsra',
      signingScope: 'organization_authority',
      issues: [],
    });
  });

  it('blocks local regulatory submission signing in production even when the legacy escape hatch is set', async () => {
    const keyPair = crypto.generateKeyPairSync('ed25519');
    process.env.NODE_ENV = 'production';
    process.env.REGULATORY_SUBMISSION_BUNDLE_ALLOW_LOCAL_SIGNING = 'true';
    process.env.REGULATORY_SUBMISSION_BUNDLE_SIGNING_PRIVATE_KEY__ORG__ORG_1__AUTHORITY__FSRA =
      keyPair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

    await expect(createRegulatorySubmissionBundleSignature('c'.repeat(64), {
      organizationId: 'org-1',
      authority: 'FSRA',
      filingJurisdiction: 'AE-ADGM',
    })).rejects.toMatchObject({
      code: 'REG_SUBMISSION_LOCAL_SIGNING_BLOCKED',
    });
  });
});
