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
import * as fs from 'fs';
import * as path from 'path';

describe('ZK public signal schema validation', () => {
  let service: ZKProofService;

  beforeEach(() => {
    service = new ZKProofService();
  });

  it('accepts public signals that exactly match a context-bound schema', () => {
    const result = service.validatePublicSignalsAgainstSchema(
      ['claims-field', '21', '1777440000', 'context-field'],
      ['claimsHash', 'ageThresholdYears', 'currentTimestamp', 'contextCommitment'],
      {
        claimsHash: 'claims-field',
        contextCommitment: 'context-field',
        publicSignals: {
          claimsHash: 'claims-field',
          ageThresholdYears: '21',
          currentTimestamp: '1777440000',
          contextCommitment: 'context-field',
        },
      },
    );

    expect(result).toEqual({ valid: true });
  });

  it('rejects missing or extra public signals', () => {
    const schema = ['claimsHash', 'ageThresholdYears', 'currentTimestamp', 'contextCommitment'];
    const expected = {
      claimsHash: 'claims-field',
      contextCommitment: 'context-field',
      publicSignals: {
        claimsHash: 'claims-field',
        ageThresholdYears: '21',
        currentTimestamp: '1777440000',
        contextCommitment: 'context-field',
      },
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
        ['claims-field', '21', '1777440000', 'context-field', 'extra'],
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
      ['claims-field', '21', 'context-field', '1777440000'],
      ['claimsHash', 'ageThresholdYears', 'currentTimestamp', 'contextCommitment'],
      {
        claimsHash: 'claims-field',
        contextCommitment: 'context-field',
        publicSignals: {
          claimsHash: 'claims-field',
          ageThresholdYears: '21',
          currentTimestamp: '1777440000',
          contextCommitment: 'context-field',
        },
      },
    );

    expect(result).toMatchObject({
      valid: false,
      code: 'PROOF_CONTEXT_NOT_COMMITTED',
    });
  });

  it('rejects policy parameter public signals that do not match the issued context', () => {
    const result = service.validatePublicSignalsAgainstSchema(
      ['claims-field', '18', '1777440000', 'context-field'],
      ['claimsHash', 'ageThresholdYears', 'currentTimestamp', 'contextCommitment'],
      {
        claimsHash: 'claims-field',
        contextCommitment: 'context-field',
        publicSignals: {
          claimsHash: 'claims-field',
          ageThresholdYears: '21',
          currentTimestamp: '1777440000',
          contextCommitment: 'context-field',
        },
      },
    );

    expect(result).toMatchObject({
      valid: false,
      code: 'PROOF_PUBLIC_SIGNAL_VALUE_MISMATCH',
    });
  });

  it('rejects freshness timestamps that do not match the issued proof context', () => {
    const result = service.validatePublicSignalsAgainstSchema(
      ['claims-field', '21', '1777449999', 'context-field'],
      ['claimsHash', 'ageThresholdYears', 'currentTimestamp', 'contextCommitment'],
      {
        claimsHash: 'claims-field',
        contextCommitment: 'context-field',
        publicSignals: {
          claimsHash: 'claims-field',
          ageThresholdYears: '21',
          currentTimestamp: '1777440000',
          contextCommitment: 'context-field',
        },
      },
    );

    expect(result).toMatchObject({
      valid: false,
      code: 'PROOF_PUBLIC_SIGNAL_VALUE_MISMATCH',
    });
  });

  it('rejects context-bound schemas when a middle public-signal expectation is missing', () => {
    const result = service.validatePublicSignalsAgainstSchema(
      ['claims-field', '21', '1777440000', 'context-field'],
      ['claimsHash', 'ageThresholdYears', 'currentTimestamp', 'contextCommitment'],
      {
        claimsHash: 'claims-field',
        contextCommitment: 'context-field',
      },
    );

    expect(result).toMatchObject({
      valid: false,
      code: 'PROOF_PUBLIC_SIGNAL_EXPECTATION_MISSING',
    });
  });

  it('refuses schemas that do not pin claimsHash first and contextCommitment last', () => {
    const result = service.validatePublicSignalsAgainstSchema(
      ['claims-field', 'context-field'],
      ['contextCommitment', 'claimsHash'],
      {
        claimsHash: 'claims-field',
        contextCommitment: 'context-field',
        publicSignals: {
          claimsHash: 'claims-field',
          contextCommitment: 'context-field',
        },
      },
    );

    expect(result).toMatchObject({
      valid: false,
      code: 'ZK_CIRCUIT_CONTEXT_BINDING_UNSUPPORTED',
    });
  });

  it('keeps current checked-in circuits fail-closed until context-bound artifacts exist', () => {
    expect(service.isCircuitContextBound('age_verification')).toBe(false);
    expect(service.isCircuitContextBound('age_verification_context_v2')).toBe(false);
    expect(service.isCircuitContextBound('nationality_check')).toBe(false);
    expect(service.isCircuitContextBound('income_range')).toBe(false);
    expect(service.listCircuits().every((circuit) => !circuit.contextBound)).toBe(true);
  });

  it('registers the v2 age schema but refuses it until compiled artifacts exist', () => {
    expect(service.getCircuitPublicSignalSchema('age_verification_context_v2')).toEqual([
      'claimsHash',
      'ageThresholdYears',
      'currentTimestamp',
      'contextCommitment',
    ]);

    expect(
      service.validateContextBoundPublicSignals(
        'age_verification_context_v2',
        ['claims-field', '21', '1777440000', 'context-field'],
        {
          claimsHash: 'claims-field',
          contextCommitment: 'context-field',
          publicSignals: {
            claimsHash: 'claims-field',
            ageThresholdYears: '21',
            currentTimestamp: '1777440000',
            contextCommitment: 'context-field',
          },
        },
      ),
    ).toMatchObject({
      valid: false,
      code: 'ZK_CIRCUIT_CONTEXT_BINDING_UNSUPPORTED',
      statusCode: 503,
    });
  });

  it('keeps the v2 age circuit source aligned with the backend public-signal contract', () => {
    const sourcePath = path.join(
      __dirname,
      '../../circuits/age/age_context_proof.circom',
    );
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).toContain(
      'component main {public [claimsHash, ageThresholdYears, currentTimestamp, contextCommitment]}',
    );
    expect(source).not.toContain('signal output');
  });
});
