jest.mock('../src/index', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  redis: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

import { ZKProofService } from '../src/services/zkproof';

describe('ZK public signal schema validation', () => {
  let service: ZKProofService;

  beforeEach(() => {
    service = new ZKProofService();
  });

  it('accepts public signals that exactly match a context-bound schema', () => {
    const result = service.validatePublicSignalsAgainstSchema(
      ['claims-field', '21', 'context-field'],
      ['claimsHash', 'ageThresholdYears', 'contextCommitment'],
      {
        claimsHash: 'claims-field',
        contextCommitment: 'context-field',
      },
    );

    expect(result).toEqual({ valid: true });
  });

  it('rejects missing or extra public signals', () => {
    const schema = ['claimsHash', 'ageThresholdYears', 'contextCommitment'];
    const expected = {
      claimsHash: 'claims-field',
      contextCommitment: 'context-field',
    };

    expect(
      service.validatePublicSignalsAgainstSchema(
        ['claims-field', 'context-field'],
        schema,
        expected,
      ),
    ).toMatchObject({
      valid: false,
      code: 'PROOF_SIGNALS_SCHEMA_INVALID',
    });

    expect(
      service.validatePublicSignalsAgainstSchema(
        ['claims-field', '21', 'context-field', 'extra'],
        schema,
        expected,
      ),
    ).toMatchObject({
      valid: false,
      code: 'PROOF_SIGNALS_SCHEMA_INVALID',
    });
  });

  it('rejects reordered commitment values even when both are present', () => {
    const result = service.validatePublicSignalsAgainstSchema(
      ['claims-field', 'context-field', '21'],
      ['claimsHash', 'ageThresholdYears', 'contextCommitment'],
      {
        claimsHash: 'claims-field',
        contextCommitment: 'context-field',
      },
    );

    expect(result).toMatchObject({
      valid: false,
      code: 'PROOF_CONTEXT_NOT_COMMITTED',
    });
  });

  it('refuses schemas that do not pin claimsHash first and contextCommitment last', () => {
    const result = service.validatePublicSignalsAgainstSchema(
      ['claims-field', 'context-field'],
      ['contextCommitment', 'claimsHash'],
      {
        claimsHash: 'claims-field',
        contextCommitment: 'context-field',
      },
    );

    expect(result).toMatchObject({
      valid: false,
      code: 'ZK_CIRCUIT_CONTEXT_BINDING_UNSUPPORTED',
    });
  });

  it('keeps current checked-in circuits fail-closed until context-bound artifacts exist', () => {
    expect(service.isCircuitContextBound('age_verification')).toBe(false);
    expect(service.isCircuitContextBound('nationality_check')).toBe(false);
    expect(service.isCircuitContextBound('income_range')).toBe(false);
    expect(service.listCircuits().every((circuit) => !circuit.contextBound)).toBe(true);
  });
});
