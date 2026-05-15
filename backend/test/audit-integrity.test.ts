import {
  AUDIT_CHAIN_GENESIS,
  AUDIT_INTEGRITY_VERSION,
  buildAuditIntegrityFields,
} from '../src/services/audit-integrity';

describe('audit integrity sealing', () => {
  const baseEntry = {
    identityId: 'identity-1',
    action: 'CREDENTIAL_ISSUED',
    resourceType: 'credential',
    resourceId: 'credential-1',
    details: {
      credentialType: 'kyc_enhanced',
      subjectId: 'subject-1',
    },
    timestamp: new Date('2026-05-15T12:00:00.000Z'),
  };

  it('creates deterministic hash-chain fields for the same audit entry', () => {
    const first = buildAuditIntegrityFields(baseEntry, AUDIT_CHAIN_GENESIS);
    const second = buildAuditIntegrityFields(baseEntry, AUDIT_CHAIN_GENESIS);

    expect(first).toEqual(second);
    expect(first.previousHash).toBe(AUDIT_CHAIN_GENESIS);
    expect(first.entryHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.integrityVersion).toBe(AUDIT_INTEGRITY_VERSION);
  });

  it('changes the entry hash when audit details are tampered', () => {
    const sealed = buildAuditIntegrityFields(baseEntry, AUDIT_CHAIN_GENESIS);
    const tampered = buildAuditIntegrityFields(
      {
        ...baseEntry,
        details: {
          ...baseEntry.details,
          subjectId: 'subject-2',
        },
      },
      AUDIT_CHAIN_GENESIS,
    );

    expect(tampered.entryHash).not.toBe(sealed.entryHash);
  });

  it('links each entry to the previous sealed entry hash', () => {
    const first = buildAuditIntegrityFields(baseEntry, AUDIT_CHAIN_GENESIS);
    const second = buildAuditIntegrityFields(
      {
        ...baseEntry,
        resourceId: 'credential-2',
      },
      first.entryHash,
    );

    expect(second.previousHash).toBe(first.entryHash);
    expect(second.entryHash).not.toBe(first.entryHash);
  });
});
