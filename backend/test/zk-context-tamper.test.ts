/**
 * ZK-01: ZK Context-Tamper Test Suite
 *
 * Validates all 8 verification steps in the zk-verify endpoint with focus on
 * context commitment binding. Each test targets a specific tampering vector:
 *
 *   1. Context commitment mismatch (step 5)
 *   2. Audience swap (step 2)
 *   3. Metadata rebinding (audience/issuedAt mismatch with nonce record)
 *   4. Claims commitment not in publicSignals (step 7)
 *   5. Context commitment not in publicSignals (step 7)
 *   6. Nonce reuse / replay (step 3)
 *   7. Expired proof (step 1)
 *   8. Future issuedAt (step 1)
 *   9. Modified subjectId in context (step 5)
 *   10. Modified credentialId in context (step 5)
 *   11. Happy-path valid proof (all 8 steps pass)
 */

import request from 'supertest';
import type { Express } from 'express';
import crypto, { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any import that triggers `../src/index`
// ---------------------------------------------------------------------------

const redisStore: Record<string, string> = {};
const redisSortedSets: Record<
  string,
  Array<{ score: number; member: string }>
> = {};
const issuedTokenHashes: Record<string, string> = {};

const mockRedis = {
  get: jest.fn(async (key: string) => redisStore[key] ?? null),
  set: jest.fn(
    async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && redisStore[key] !== undefined) {
        return null;
      }
      redisStore[key] = value;
      return 'OK';
    },
  ),
  del: jest.fn(async (key: string) => {
    delete redisStore[key];
    return 1;
  }),
  ping: jest.fn(async () => 'PONG'),
  connect: jest.fn(async () => {}),
  disconnect: jest.fn(),
  on: jest.fn(),
  pipeline: jest.fn(() => {
    const pipe: any = {
      zremrangebyscore: jest.fn().mockReturnThis(),
      zadd: jest.fn().mockReturnThis(),
      zcard: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn(async () => [
        [null, 'OK'],
        [null, 1],
        [null, 1], // zcard — keep under rate limit
        [null, 1],
      ]),
    };
    return pipe;
  }),
};

jest.mock('ioredis', () => jest.fn(() => mockRedis));

// Mock Prisma
const mockPrismaSession = {
  create: jest.fn(async () => ({})),
  findUnique: jest.fn(async () => null),
  delete: jest.fn(async () => ({})),
};

const mockPrismaIdentity = {
  findUnique: jest.fn(async () => null),
  create: jest.fn(async () => ({})),
};

const mockPrismaVerification = {
  create: jest.fn(async () => ({})),
  findMany: jest.fn(async () => []),
  count: jest.fn(async () => 0),
};

const mockPrismaCredential = {
  findUnique: jest.fn(async () => null),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => ({
    $connect: jest.fn(async () => {}),
    $disconnect: jest.fn(async () => {}),
    $queryRaw: jest.fn(async () => [{ '?column?': 1 }]),
    session: mockPrismaSession,
    identity: mockPrismaIdentity,
    verification: mockPrismaVerification,
    credential: mockPrismaCredential,
  })),
}));

jest.mock('prom-client', () => ({
  Registry: jest.fn(() => ({
    contentType: 'text/plain',
    metrics: jest.fn(async () => ''),
    registerMetric: jest.fn(),
  })),
  collectDefaultMetrics: jest.fn(),
  Counter: jest.fn(() => ({ inc: jest.fn() })),
  Histogram: jest.fn(() => ({ observe: jest.fn() })),
}));

// Mock ZK proof service — verifyProof returns valid by default
const mockVerifyProof = jest.fn(async () => ({
  valid: true,
  proofId: 'proof-mock-id',
  circuitName: 'ageCheck',
  publicSignals: ['1', '2'],
  verifiedAt: new Date().toISOString(),
}));
const mockIsCircuitContextBound = jest.fn(() => true);

jest.mock('../src/services/zkproof', () => ({
  zkProofService: {
    generateProof: jest.fn(async () => ({
      proofId: 'proof-mock-id',
      proof: {
        pi_a: ['1'],
        pi_b: [['1']],
        pi_c: ['1'],
        protocol: 'groth16',
        curve: 'bn128',
      },
      publicSignals: ['1', '2'],
      circuitName: 'ageCheck',
      generatedAt: new Date().toISOString(),
      generationTimeMs: 42,
    })),
    verifyProof: mockVerifyProof,
    isCircuitContextBound: mockIsCircuitContextBound,
    buildSelectiveDisclosureInputs: jest.fn(() => ({})),
    listCircuits: jest.fn(() => []),
  },
}));

jest.mock('../src/services/tee', () => ({
  teeService: {
    verifyAttestation: jest.fn(async () => ({
      attestationId: 'attest-mock',
      verified: true,
      enclaveType: 'SGX',
      tcbStatus: 'UpToDate',
      advisoryIds: [],
      timestamp: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    })),
  },
}));

jest.mock('../src/services/credential', () => ({
  credentialService: {
    getCredential: jest.fn(async () => null),
    issueCredential: jest.fn(async () => ({ id: 'cred-1' })),
    queryCredentials: jest.fn(async () => ({ credentials: [], total: 0 })),
    revokeCredential: jest.fn(async () => ({})),
    verifyCredential: jest.fn(async () => ({
      valid: true,
      checks: [],
      credential: {},
    })),
    exportCredentialEvidence: jest.fn(async () => ({
      formatVersion: 'zeroid.credential_evidence_export.v1',
      exportedAt: new Date().toISOString(),
      credential: {},
      verification: { valid: true, checks: {} },
      issuer: { identityId: 'issuer-1' },
      subject: { identityId: 'subject-1' },
    })),
  },
}));

jest.mock('../src/services/identity', () => ({
  identityService: {
    register: jest.fn(async () => ({
      identity: { id: 'id-1', did: 'did:aethelred:alice' },
      token: 'mock-token',
      sessionId: 'sess-1',
    })),
    getIdentity: jest.fn(async () => null),
    updateIdentity: jest.fn(async () => ({})),
    recoverIdentity: jest.fn(async () => ({})),
    addDelegation: jest.fn(async () => ({})),
    revokeDelegation: jest.fn(async () => ({})),
    logout: jest.fn(async () => {}),
  },
}));

jest.mock('../src/services/government-api', () => ({
  governmentAPIService: {
    getVerificationStatus: jest.fn(async () => null),
  },
}));

jest.mock('../src/routes/governance', () => {
  const { Router } = require('express');
  return { governanceRoutes: Router() };
});

jest.mock('../src/routes/audit', () => {
  const { Router } = require('express');
  return { auditRoutes: Router() };
});

jest.mock('../src/routes/enterprise/integration', () => {
  const { Router } = require('express');
  return { __esModule: true, default: Router(), oidcPublicRouter: Router() };
});

jest.mock('../src/routes/enterprise/compliance', () => {
  const { Router } = require('express');
  return { __esModule: true, default: Router() };
});

jest.mock('winston', () => {
  const noop = jest.fn();
  const mockLogger = { info: noop, warn: noop, error: noop, debug: noop };
  return {
    createLogger: jest.fn(() => mockLogger),
    format: {
      combine: jest.fn(),
      timestamp: jest.fn(),
      errors: jest.fn(),
      json: jest.fn(),
      colorize: jest.fn(),
      simple: jest.fn(),
    },
    transports: { Console: jest.fn() },
  };
});

// ---------------------------------------------------------------------------
// Import app AFTER all mocks
// ---------------------------------------------------------------------------
import app from '../src/index';
import * as jose from 'jose';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'test-secret-that-is-at-least-32-chars!!',
);
const JWT_ISSUER = 'zeroid-api';
const JWT_AUDIENCE = 'zeroid-client';

const VERIFIER_ID = 'verifier-1';
const VERIFIER_DID = 'did:aethelred:verifier';
const SUBJECT_ID = 'subject-1';
const CREDENTIAL_ID = 'cred-abc-123';
const CREDENTIAL_CLAIMS = { birthYear: 1990, country: 'AE' };

function canonicalizeClaims(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalizeClaims(item)).join(',') + ']';
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map(
    (key) => JSON.stringify(key) + ':' + canonicalizeClaims(obj[key]),
  );
  return '{' + entries.join(',') + '}';
}

function computeClaimsHash(claims: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalizeClaims(claims)).digest('hex');
}

function digestToFieldElement(hexDigest: string): string {
  return BigInt('0x' + hexDigest.substring(0, 62)).toString();
}

const CREDENTIAL_CLAIMS_HASH = computeClaimsHash(CREDENTIAL_CLAIMS);
const CREDENTIAL_CLAIMS_FIELD = digestToFieldElement(CREDENTIAL_CLAIMS_HASH);

async function makeToken(
  overrides: Partial<{
    sub: string;
    did: string;
    jti: string;
    exp: number;
    iss: string;
    aud: string;
  }> = {},
): Promise<string> {
  const sub = overrides.sub ?? VERIFIER_ID;
  const did = overrides.did ?? VERIFIER_DID;
  const jti = overrides.jti ?? 'session-1';

  const builder = new jose.SignJWT({ did } as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(sub)
    .setIssuedAt()
    .setJti(jti)
    .setIssuer(overrides.iss ?? JWT_ISSUER)
    .setAudience(overrides.aud ?? JWT_AUDIENCE);

  if (overrides.exp !== undefined) {
    builder.setExpirationTime(overrides.exp);
  } else {
    builder.setExpirationTime('1h');
  }

  const token = await builder.sign(JWT_SECRET);
  issuedTokenHashes[jti] = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
  return token;
}

function stubAuthFor(identityId: string, did: string, sessionId = 'session-1') {
  mockRedis.get.mockImplementation(async (key: string) => {
    if (key === `session:${sessionId}`) {
      return JSON.stringify({
        identityId,
        did,
        tokenHash: issuedTokenHashes[sessionId],
      });
    }
    if (key.startsWith('revoked:')) return null;
    return redisStore[key] ?? null;
  });

  mockPrismaIdentity.findUnique.mockImplementation(async (args: any) => {
    if (args?.where?.id === identityId || args?.where?.did === did) {
      return { id: identityId, did, publicKey: 'AAAA', status: 'ACTIVE' };
    }
    return null;
  });
}

/**
 * Compute the contextCommitmentField exactly as the verification route does:
 * SHA-256(nonce:audience:subjectId:credentialId:issuedAt) truncated to 253 bits.
 */
function computeContextCommitmentField(
  nonce: string,
  audience: string,
  subjectId: string,
  credentialId: string,
  issuedAt: number,
): string {
  const hash = createHash('sha256')
    .update(`${nonce}:${audience}:${subjectId}:${credentialId}:${issuedAt}`)
    .digest('hex');
  return BigInt('0x' + hash.substring(0, 62)).toString();
}

function proofNonceScopedKey(prefix: string, nonce: string): string {
  return `${prefix}:${createHash('sha256').update(nonce).digest('hex')}`;
}

/** Seed a nonce record into the mock Redis store (simulating proof generation). */
function seedNonce(
  nonce: string,
  audience: string,
  subjectId: string,
  credentialId: string,
  issuedAt: number,
  contextCommitmentField: string,
  claimsHashField = CREDENTIAL_CLAIMS_FIELD,
) {
  redisStore[proofNonceScopedKey('proof:nonce', nonce)] = JSON.stringify({
    nonce,
    audience,
    subjectId,
    credentialId,
    issuedAt,
    claimsHashField,
    contextCommitmentField,
  });
}

/** Build a valid proof payload that passes all 8 verification steps. */
function buildValidPayload(
  overrides: Partial<{
    nonce: string;
    audience: string;
    contextCommitment: string;
    issuedAt: number;
    publicSignals: string[];
  }> = {},
) {
  const nonce = overrides.nonce ?? 'nonce-1234567890abcdef';
  const audience = overrides.audience ?? VERIFIER_ID;
  const issuedAt = overrides.issuedAt ?? Date.now() - 1000;
  const ctxField =
    overrides.contextCommitment ??
    computeContextCommitmentField(
      nonce,
      audience,
      SUBJECT_ID,
      CREDENTIAL_ID,
      issuedAt,
    );
  const publicSignals = overrides.publicSignals ?? [
    CREDENTIAL_CLAIMS_FIELD,
    '2',
    ctxField,
  ];

  return {
    proof: {
      pi_a: ['1', '2', '3'],
      pi_b: [
        ['1', '2'],
        ['3', '4'],
        ['5', '6'],
      ],
      pi_c: ['1', '2', '3'],
      protocol: 'groth16',
      curve: 'bn128',
    },
    publicSignals,
    circuitName: 'ageCheck',
    nonce,
    audience,
    contextCommitment: ctxField,
    issuedAt,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();
  mockIsCircuitContextBound.mockReturnValue(true);
  for (const k of Object.keys(redisStore)) delete redisStore[k];
  for (const k of Object.keys(redisSortedSets)) delete redisSortedSets[k];
  for (const k of Object.keys(issuedTokenHashes)) delete issuedTokenHashes[k];

  const { credentialService } = require('../src/services/credential');
  credentialService.getCredential.mockResolvedValue({
    id: CREDENTIAL_ID,
    credentialType: 'age_verification',
    issuerId: 'issuer-1',
    subjectId: SUBJECT_ID,
    claims: CREDENTIAL_CLAIMS,
    claimsHash: CREDENTIAL_CLAIMS_HASH,
    proof: {},
    status: 'ACTIVE',
    issuedAt: new Date(),
    expiresAt: null,
  });
});

// =========================================================================
// ZK Context-Tamper Tests
// =========================================================================
describe('ZK-01: Context-tamper verification', () => {
  it('rejects circuits that are not declared context-bound', async () => {
    const token = await makeToken({ sub: VERIFIER_ID, did: VERIFIER_DID });
    stubAuthFor(VERIFIER_ID, VERIFIER_DID);
    mockIsCircuitContextBound.mockReturnValue(false);

    const payload = buildValidPayload({
      nonce: 'nonce-unbound-circuit1',
    });

    const res = await request(app as Express)
      .post('/api/v1/verification/zk-verify')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('ZK_CIRCUIT_CONTEXT_BINDING_UNSUPPORTED');
    expect(mockVerifyProof).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 1. Context commitment mismatch
  // -----------------------------------------------------------------------
  it('rejects when contextCommitment does not match recomputed value from nonce metadata', async () => {
    const token = await makeToken({ sub: VERIFIER_ID, did: VERIFIER_DID });
    stubAuthFor(VERIFIER_ID, VERIFIER_DID);

    const nonce = 'nonce-ctx-mismatch-test';
    const issuedAt = Date.now() - 2000;
    const correctField = computeContextCommitmentField(
      nonce,
      VERIFIER_ID,
      SUBJECT_ID,
      CREDENTIAL_ID,
      issuedAt,
    );
    seedNonce(
      nonce,
      VERIFIER_ID,
      SUBJECT_ID,
      CREDENTIAL_ID,
      issuedAt,
      correctField,
    );

    // Supply a wrong contextCommitment
    const wrongField = '999999999999999999999999999999';
    const payload = buildValidPayload({
      nonce,
      audience: VERIFIER_ID,
      contextCommitment: wrongField,
      issuedAt,
      publicSignals: [CREDENTIAL_CLAIMS_FIELD, '2', wrongField],
    });

    const res = await request(app as Express)
      .post('/api/v1/verification/zk-verify')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PROOF_CONTEXT_INVALID');
  });

  // -----------------------------------------------------------------------
  // 2. Audience swap
  // -----------------------------------------------------------------------
  it('rejects when proof was generated for audience A but verifier B tries to verify', async () => {
    const token = await makeToken({ sub: VERIFIER_ID, did: VERIFIER_DID });
    stubAuthFor(VERIFIER_ID, VERIFIER_DID);

    // Proof was generated for a different audience
    const payload = buildValidPayload({
      audience: 'some-other-verifier',
    });

    const res = await request(app as Express)
      .post('/api/v1/verification/zk-verify')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PROOF_AUDIENCE_MISMATCH');
  });

  // -----------------------------------------------------------------------
  // 3. Context metadata rebinding
  // -----------------------------------------------------------------------
  it('rejects when body audience differs from the audience stored in the nonce record', async () => {
    const token = await makeToken({ sub: VERIFIER_ID, did: VERIFIER_DID });
    stubAuthFor(VERIFIER_ID, VERIFIER_DID);

    const nonce = 'nonce-audience-rebind';
    const issuedAt = Date.now() - 1000;
    const ctxField = computeContextCommitmentField(
      nonce,
      VERIFIER_DID,
      SUBJECT_ID,
      CREDENTIAL_ID,
      issuedAt,
    );
    seedNonce(
      nonce,
      VERIFIER_DID,
      SUBJECT_ID,
      CREDENTIAL_ID,
      issuedAt,
      ctxField,
    );

    const payload = buildValidPayload({
      nonce,
      audience: VERIFIER_ID,
      contextCommitment: ctxField,
      issuedAt,
      publicSignals: [CREDENTIAL_CLAIMS_FIELD, '2', ctxField],
    });

    const res = await request(app as Express)
      .post('/api/v1/verification/zk-verify')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PROOF_CONTEXT_METADATA_MISMATCH');
  });

  it('rejects when body issuedAt differs from the issuedAt stored in the nonce record', async () => {
    const token = await makeToken({ sub: VERIFIER_ID, did: VERIFIER_DID });
    stubAuthFor(VERIFIER_ID, VERIFIER_DID);

    const nonce = 'nonce-issued-at-rebind';
    const nonceIssuedAt = Date.now() - 2000;
    const bodyIssuedAt = Date.now() - 1000;
    const ctxField = computeContextCommitmentField(
      nonce,
      VERIFIER_ID,
      SUBJECT_ID,
      CREDENTIAL_ID,
      nonceIssuedAt,
    );
    seedNonce(
      nonce,
      VERIFIER_ID,
      SUBJECT_ID,
      CREDENTIAL_ID,
      nonceIssuedAt,
      ctxField,
    );

    const payload = buildValidPayload({
      nonce,
      audience: VERIFIER_ID,
      contextCommitment: ctxField,
      issuedAt: bodyIssuedAt,
      publicSignals: [CREDENTIAL_CLAIMS_FIELD, '2', ctxField],
    });

    const res = await request(app as Express)
      .post('/api/v1/verification/zk-verify')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PROOF_CONTEXT_METADATA_MISMATCH');
  });

  // -----------------------------------------------------------------------
  // 4. Claims commitment not in publicSignals
  // -----------------------------------------------------------------------
  it('rejects when claimsHash is not the first public signal', async () => {
    const token = await makeToken({ sub: VERIFIER_ID, did: VERIFIER_DID });
    stubAuthFor(VERIFIER_ID, VERIFIER_DID);

    const nonce = 'nonce-claims-signal';
    const issuedAt = Date.now() - 1000;
    const ctxField = computeContextCommitmentField(
      nonce,
      VERIFIER_ID,
      SUBJECT_ID,
      CREDENTIAL_ID,
      issuedAt,
    );
    seedNonce(
      nonce,
      VERIFIER_ID,
      SUBJECT_ID,
      CREDENTIAL_ID,
      issuedAt,
      ctxField,
    );

    const payload = buildValidPayload({
      nonce,
      audience: VERIFIER_ID,
      contextCommitment: ctxField,
      issuedAt,
      publicSignals: ['999999', '2', ctxField],
    });

    const res = await request(app as Express)
      .post('/api/v1/verification/zk-verify')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PROOF_CLAIMS_HASH_NOT_COMMITTED');
  });

  // -----------------------------------------------------------------------
  // 5. Context commitment not in publicSignals
  // -----------------------------------------------------------------------
  it('rejects when contextCommitment is valid but not present in publicSignals array', async () => {
    const token = await makeToken({ sub: VERIFIER_ID, did: VERIFIER_DID });
    stubAuthFor(VERIFIER_ID, VERIFIER_DID);

    const nonce = 'nonce-not-in-signals';
    const issuedAt = Date.now() - 1000;
    const ctxField = computeContextCommitmentField(
      nonce,
      VERIFIER_ID,
      SUBJECT_ID,
      CREDENTIAL_ID,
      issuedAt,
    );
    seedNonce(
      nonce,
      VERIFIER_ID,
      SUBJECT_ID,
      CREDENTIAL_ID,
      issuedAt,
      ctxField,
    );

    // publicSignals does NOT include ctxField
    const payload = buildValidPayload({
      nonce,
      audience: VERIFIER_ID,
      contextCommitment: ctxField,
      issuedAt,
      publicSignals: [CREDENTIAL_CLAIMS_FIELD, '2', '3'], // missing ctxField
    });

    const res = await request(app as Express)
      .post('/api/v1/verification/zk-verify')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PROOF_CONTEXT_NOT_COMMITTED');
  });

  // -----------------------------------------------------------------------
  // 4. Nonce reuse (replay)
  // -----------------------------------------------------------------------
  it('rejects the second verification with the same nonce', async () => {
    const token = await makeToken({ sub: VERIFIER_ID, did: VERIFIER_DID });
    stubAuthFor(VERIFIER_ID, VERIFIER_DID);

    const nonce = 'nonce-replay-attempt1';
    const issuedAt = Date.now() - 1000;
    const ctxField = computeContextCommitmentField(
      nonce,
      VERIFIER_ID,
      SUBJECT_ID,
      CREDENTIAL_ID,
      issuedAt,
    );
    seedNonce(
      nonce,
      VERIFIER_ID,
      SUBJECT_ID,
      CREDENTIAL_ID,
      issuedAt,
      ctxField,
    );

    const payload = buildValidPayload({
      nonce,
      audience: VERIFIER_ID,
      contextCommitment: ctxField,
      issuedAt,
      publicSignals: [CREDENTIAL_CLAIMS_FIELD, '2', ctxField],
    });

    // First verification succeeds
    const res1 = await request(app as Express)
      .post('/api/v1/verification/zk-verify')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res1.status).toBe(200);
    expect(res1.body.data.valid).toBe(true);

    // Re-seed the nonce so step 4 doesn't reject (the nonce was deleted on first verify).
    // But the replay key is now set, so step 3 should reject.
    seedNonce(
      nonce,
      VERIFIER_ID,
      SUBJECT_ID,
      CREDENTIAL_ID,
      issuedAt,
      ctxField,
    );

    const res2 = await request(app as Express)
      .post('/api/v1/verification/zk-verify')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res2.status).toBe(409);
    expect(res2.body.code).toBe('PROOF_REPLAY');
  });

  it('rejects a concurrent double-submit while the nonce is being verified', async () => {
    const token = await makeToken({ sub: VERIFIER_ID, did: VERIFIER_DID });
    stubAuthFor(VERIFIER_ID, VERIFIER_DID);

    const nonce = 'nonce-concurrent-race1';
    const issuedAt = Date.now() - 1000;
    const ctxField = computeContextCommitmentField(
      nonce,
      VERIFIER_ID,
      SUBJECT_ID,
      CREDENTIAL_ID,
      issuedAt,
    );
    seedNonce(
      nonce,
      VERIFIER_ID,
      SUBJECT_ID,
      CREDENTIAL_ID,
      issuedAt,
      ctxField,
    );

    mockVerifyProof.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                valid: true,
                proofId: 'proof-concurrent-id',
                circuitName: 'ageCheck',
                publicSignals: [CREDENTIAL_CLAIMS_FIELD, '2', ctxField],
                verifiedAt: new Date(),
              }),
            50,
          );
        }),
    );

    const payload = buildValidPayload({
      nonce,
      audience: VERIFIER_ID,
      contextCommitment: ctxField,
      issuedAt,
      publicSignals: [CREDENTIAL_CLAIMS_FIELD, '2', ctxField],
    });

    const [first, second] = await Promise.all([
      request(app as Express)
        .post('/api/v1/verification/zk-verify')
        .set('Authorization', `Bearer ${token}`)
        .send(payload),
      request(app as Express)
        .post('/api/v1/verification/zk-verify')
        .set('Authorization', `Bearer ${token}`)
        .send(payload),
    ]);

    const responses = [first, second].sort((a, b) => a.status - b.status);
    expect(responses[0].status).toBe(200);
    expect(responses[0].body.data.valid).toBe(true);
    expect(responses[1].status).toBe(409);
    expect(responses[1].body.code).toBe('PROOF_VERIFICATION_IN_PROGRESS');
  });

  // -----------------------------------------------------------------------
  // 5. Expired proof
  // -----------------------------------------------------------------------
  it('rejects proof older than MAX_PROOF_AGE_MS (5 minutes)', async () => {
    const token = await makeToken({ sub: VERIFIER_ID, did: VERIFIER_DID });
    stubAuthFor(VERIFIER_ID, VERIFIER_DID);

    const issuedAt = Date.now() - 6 * 60 * 1000; // 6 minutes ago
    const payload = buildValidPayload({ issuedAt });

    const res = await request(app as Express)
      .post('/api/v1/verification/zk-verify')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PROOF_EXPIRED');
  });

  // -----------------------------------------------------------------------
  // 6. Future issuedAt
  // -----------------------------------------------------------------------
  it('rejects proof with issuedAt in the future', async () => {
    const token = await makeToken({ sub: VERIFIER_ID, did: VERIFIER_DID });
    stubAuthFor(VERIFIER_ID, VERIFIER_DID);

    const issuedAt = Date.now() + 60_000; // 1 minute in the future
    const payload = buildValidPayload({ issuedAt });

    const res = await request(app as Express)
      .post('/api/v1/verification/zk-verify')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PROOF_FUTURE_TIMESTAMP');
  });

  // -----------------------------------------------------------------------
  // 7. Modified subjectId in context
  // -----------------------------------------------------------------------
  it('rejects when nonce record has a different subjectId than expected', async () => {
    const token = await makeToken({ sub: VERIFIER_ID, did: VERIFIER_DID });
    stubAuthFor(VERIFIER_ID, VERIFIER_DID);

    const nonce = 'nonce-subject-tamper1';
    const issuedAt = Date.now() - 1000;

    // Compute commitment with the WRONG subjectId
    const tampered = 'evil-subject-id';
    const tamperedField = computeContextCommitmentField(
      nonce,
      VERIFIER_ID,
      tampered,
      CREDENTIAL_ID,
      issuedAt,
    );

    // But seed the nonce record with the REAL subjectId
    const realField = computeContextCommitmentField(
      nonce,
      VERIFIER_ID,
      SUBJECT_ID,
      CREDENTIAL_ID,
      issuedAt,
    );
    seedNonce(
      nonce,
      VERIFIER_ID,
      SUBJECT_ID,
      CREDENTIAL_ID,
      issuedAt,
      realField,
    );

    // Attacker sends the tampered commitment
    const payload = buildValidPayload({
      nonce,
      audience: VERIFIER_ID,
      contextCommitment: tamperedField,
      issuedAt,
      publicSignals: [CREDENTIAL_CLAIMS_FIELD, '2', tamperedField],
    });

    const res = await request(app as Express)
      .post('/api/v1/verification/zk-verify')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PROOF_CONTEXT_INVALID');
  });

  // -----------------------------------------------------------------------
  // 8. Modified credentialId in context
  // -----------------------------------------------------------------------
  it('rejects when nonce record has a different credentialId than expected', async () => {
    const token = await makeToken({ sub: VERIFIER_ID, did: VERIFIER_DID });
    stubAuthFor(VERIFIER_ID, VERIFIER_DID);

    const nonce = 'nonce-cred-tamper-01';
    const issuedAt = Date.now() - 1000;

    // Compute commitment with the WRONG credentialId
    const tampered = 'evil-credential-id';
    const tamperedField = computeContextCommitmentField(
      nonce,
      VERIFIER_ID,
      SUBJECT_ID,
      tampered,
      issuedAt,
    );

    // But seed the nonce record with the REAL credentialId
    const realField = computeContextCommitmentField(
      nonce,
      VERIFIER_ID,
      SUBJECT_ID,
      CREDENTIAL_ID,
      issuedAt,
    );
    seedNonce(
      nonce,
      VERIFIER_ID,
      SUBJECT_ID,
      CREDENTIAL_ID,
      issuedAt,
      realField,
    );

    const payload = buildValidPayload({
      nonce,
      audience: VERIFIER_ID,
      contextCommitment: tamperedField,
      issuedAt,
      publicSignals: [CREDENTIAL_CLAIMS_FIELD, '2', tamperedField],
    });

    const res = await request(app as Express)
      .post('/api/v1/verification/zk-verify')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PROOF_CONTEXT_INVALID');
  });

  // -----------------------------------------------------------------------
  // 9. Happy path — valid proof passes all 8 steps
  // -----------------------------------------------------------------------
  it('accepts a valid proof with correct contextCommitment in publicSignals', async () => {
    const token = await makeToken({ sub: VERIFIER_ID, did: VERIFIER_DID });
    stubAuthFor(VERIFIER_ID, VERIFIER_DID);

    const nonce = 'nonce-happy-path-0001';
    const issuedAt = Date.now() - 1000;
    const ctxField = computeContextCommitmentField(
      nonce,
      VERIFIER_ID,
      SUBJECT_ID,
      CREDENTIAL_ID,
      issuedAt,
    );
    seedNonce(
      nonce,
      VERIFIER_ID,
      SUBJECT_ID,
      CREDENTIAL_ID,
      issuedAt,
      ctxField,
    );

    const payload = buildValidPayload({
      nonce,
      audience: VERIFIER_ID,
      contextCommitment: ctxField,
      issuedAt,
      publicSignals: [CREDENTIAL_CLAIMS_FIELD, '2', ctxField],
    });

    const res = await request(app as Express)
      .post('/api/v1/verification/zk-verify')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.contextBinding).toEqual(
      expect.objectContaining({
        nonce,
        audience: VERIFIER_ID,
        issuedAt,
        replayProtected: true,
        contextCommittedInProof: true,
      }),
    );

    // Nonce should be consumed.
    expect(redisStore[proofNonceScopedKey('proof:used', nonce)]).toBeDefined();
    // Original nonce should be deleted
    expect(redisStore[proofNonceScopedKey('proof:nonce', nonce)]).toBeUndefined();
  });
});
