/**
 * BBS+ Signature Client — Unit Tests
 *
 * Comprehensive tests for the BBS+ module covering:
 * - Blinded credential requests (message count validation, commitment, PoK)
 * - Selective disclosure proof derivation (message count, domain, hidden/revealed)
 * - BBS proof verification (structure, domain, index bounds, challenge, nonce)
 * - Presentation generation (domain binding, holder binding, timestamps)
 * - Credential blinding and unblinding (round-trip, length mismatch)
 * - Multi-message commitment (generator shortage, verification)
 */

import {
  createBlindedCredentialRequest,
  deriveSelectiveDisclosureProof,
  verifyBBSProof,
  generatePresentation,
  blindCredential,
  unblindCredential,
  createMultiMessageCommitment,
  verifyMultiMessageCommitment,
} from '@/lib/crypto/bbs-plus';
import type {
  BBSPublicKey,
  BBSSignature,
  BBSSelectiveDisclosureProof,
} from '@/lib/crypto/bbs-plus';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let digestCallCount = 0;

const mockDigest = jest.fn(async (_algo: string, data: ArrayBuffer) => {
  digestCallCount++;
  const input = new Uint8Array(data);
  const output = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    output[i] = (input[i % input.length] + i + digestCallCount) & 0xff;
  }
  return output.buffer;
});

let randomCounter = 0;
const mockGetRandomValues = jest.fn((arr: Uint8Array) => {
  randomCounter++;
  for (let i = 0; i < arr.length; i++) {
    arr[i] = (i + randomCounter * 7) & 0xff;
  }
  return arr;
});

Object.defineProperty(globalThis, 'crypto', {
  value: {
    subtle: { digest: mockDigest },
    getRandomValues: mockGetRandomValues,
  },
  writable: true,
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePublicKey(messageCount = 3): BBSPublicKey {
  return {
    w: '0xpk_w',
    h0: '0xpk_h0',
    h: Array.from({ length: messageCount }, (_, i) => `0xpk_h${i}`),
    messageCount,
  };
}

function makeSignature(): BBSSignature {
  return {
    a: '0xsig_a',
    e: '0xsig_e',
    s: '0xsig_s',
  };
}

function makeMessages(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `0xmsg_${i}`);
}

// ---------------------------------------------------------------------------
// createBlindedCredentialRequest
// ---------------------------------------------------------------------------

describe('createBlindedCredentialRequest', () => {
  beforeEach(() => {
    mockDigest.mockClear();
    mockGetRandomValues.mockClear();
    digestCallCount = 0;
    randomCounter = 0;
  });

  it('creates a valid blinded credential request', async () => {
    const pk = makePublicKey(3);
    const messages = makeMessages(3);

    const result = await createBlindedCredentialRequest(pk, messages, [0, 2]);

    expect(result.commitment).toBeTruthy();
    expect(result.blindingFactor).toBeTruthy();
    expect(result.proofOfKnowledge).toBeDefined();
    expect(result.proofOfKnowledge.challenge).toBeTruthy();
    expect(result.proofOfKnowledge.responses).toHaveLength(2);
    expect(result.proofOfKnowledge.commitment).toBeTruthy();
    expect(result.blindedIndices).toEqual([0, 2]);
    expect(result.nonce).toBeTruthy();
  });

  it('throws when message count does not match public key', async () => {
    const pk = makePublicKey(3);
    const messages = makeMessages(5);

    await expect(
      createBlindedCredentialRequest(pk, messages, [0]),
    ).rejects.toThrow('Message count mismatch: expected 3, got 5');
  });

  it('uses provided nonce instead of generating one', async () => {
    const pk = makePublicKey(2);
    const messages = makeMessages(2);
    const customNonce = '0xcustom_nonce';

    const result = await createBlindedCredentialRequest(pk, messages, [0], customNonce);

    expect(result.nonce).toBe(customNonce);
  });

  it('populates revealed messages correctly', async () => {
    const pk = makePublicKey(4);
    const messages = makeMessages(4);

    const result = await createBlindedCredentialRequest(pk, messages, [1, 3]);

    // Indices 0 and 2 should be revealed
    expect(result.revealedMessages.get(0)).toBe('0xmsg_0');
    expect(result.revealedMessages.get(2)).toBe('0xmsg_2');
    expect(result.revealedMessages.has(1)).toBe(false);
    expect(result.revealedMessages.has(3)).toBe(false);
  });

  it('handles all messages blinded (none revealed)', async () => {
    const pk = makePublicKey(2);
    const messages = makeMessages(2);

    const result = await createBlindedCredentialRequest(pk, messages, [0, 1]);

    expect(result.revealedMessages.size).toBe(0);
    expect(result.blindedIndices).toEqual([0, 1]);
  });

  it('handles no messages blinded (all revealed)', async () => {
    const pk = makePublicKey(2);
    const messages = makeMessages(2);

    const result = await createBlindedCredentialRequest(pk, messages, []);

    expect(result.revealedMessages.size).toBe(2);
    expect(result.blindedIndices).toEqual([]);
    expect(result.proofOfKnowledge.responses).toHaveLength(0);
  });

  it('generates random blinding factor', async () => {
    const pk = makePublicKey(1);
    const messages = makeMessages(1);

    const result = await createBlindedCredentialRequest(pk, messages, [0]);

    expect(mockGetRandomValues).toHaveBeenCalled();
    expect(result.blindingFactor).toMatch(/^0x[0-9a-f]+$/);
  });
});

// ---------------------------------------------------------------------------
// deriveSelectiveDisclosureProof
// ---------------------------------------------------------------------------

describe('deriveSelectiveDisclosureProof', () => {
  beforeEach(() => {
    mockDigest.mockClear();
    mockGetRandomValues.mockClear();
    digestCallCount = 0;
    randomCounter = 0;
  });

  it('derives a selective disclosure proof', async () => {
    const pk = makePublicKey(3);
    const sig = makeSignature();
    const messages = makeMessages(3);

    const proof = await deriveSelectiveDisclosureProof(sig, pk, messages, [0, 2], 'test.domain');

    expect(proof.aPrime).toBeTruthy();
    expect(proof.aBar).toBeTruthy();
    expect(proof.d).toBeTruthy();
    expect(proof.proofC).toBeTruthy();
    expect(proof.domain).toBe('test.domain');
    expect(proof.revealedIndices).toEqual([0, 2]);
    expect(proof.revealedMessages.get(0)).toBe('0xmsg_0');
    expect(proof.revealedMessages.get(2)).toBe('0xmsg_2');
    expect(proof.revealedMessages.has(1)).toBe(false);
  });

  it('throws when message count does not match public key', async () => {
    const pk = makePublicKey(3);
    const sig = makeSignature();
    const messages = makeMessages(2);

    await expect(
      deriveSelectiveDisclosureProof(sig, pk, messages, [0], 'domain'),
    ).rejects.toThrow('Message count does not match public key');
  });

  it('uses provided nonce', async () => {
    const pk = makePublicKey(2);
    const sig = makeSignature();
    const messages = makeMessages(2);

    const proof = await deriveSelectiveDisclosureProof(
      sig, pk, messages, [0], 'domain', '0xcustom_nonce',
    );

    expect(proof.nonce).toBe('0xcustom_nonce');
  });

  it('generates nonce when not provided', async () => {
    const pk = makePublicKey(2);
    const sig = makeSignature();
    const messages = makeMessages(2);

    const proof = await deriveSelectiveDisclosureProof(sig, pk, messages, [0], 'domain');

    expect(proof.nonce).toBeTruthy();
    expect(proof.nonce.length).toBeGreaterThan(0);
  });

  it('includes responses for hidden messages plus e, r1, r2', async () => {
    const pk = makePublicKey(5);
    const sig = makeSignature();
    const messages = makeMessages(5);

    // Reveal indices 1 and 3 -> hidden: 0, 2, 4 (3 hidden) + 3 extra (e, r1, r2)
    const proof = await deriveSelectiveDisclosureProof(sig, pk, messages, [1, 3], 'domain');

    expect(proof.proofResponses).toHaveLength(6); // 3 hidden + 3
  });

  it('handles all messages revealed', async () => {
    const pk = makePublicKey(2);
    const sig = makeSignature();
    const messages = makeMessages(2);

    const proof = await deriveSelectiveDisclosureProof(sig, pk, messages, [0, 1], 'domain');

    // 0 hidden + 3 extra
    expect(proof.proofResponses).toHaveLength(3);
    expect(proof.revealedMessages.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// verifyBBSProof
// ---------------------------------------------------------------------------

describe('verifyBBSProof', () => {
  beforeEach(() => {
    mockDigest.mockClear();
    digestCallCount = 0;
    randomCounter = 0;
  });

  it('validates a well-formed proof', async () => {
    const pk = makePublicKey(3);
    const sig = makeSignature();
    const messages = makeMessages(3);

    // Generate a real proof so the challenge recomputation matches
    const proof = await deriveSelectiveDisclosureProof(sig, pk, messages, [0], 'test.domain');
    const result = await verifyBBSProof(proof, pk);

    expect(result.checks.find((c) => c.name === 'proof_structure')?.passed).toBe(true);
    expect(result.checks.find((c) => c.name === 'domain_binding')?.passed).toBe(true);
    expect(result.checks.find((c) => c.name === 'index_bounds')?.passed).toBe(true);
    expect(result.checks.find((c) => c.name === 'nonce_freshness')?.passed).toBe(true);
  });

  it('fails proof_structure when aPrime is empty', async () => {
    const pk = makePublicKey(2);
    const proof: BBSSelectiveDisclosureProof = {
      aPrime: '',
      aBar: '0xbar',
      d: '0xd',
      proofC: '0xc',
      proofResponses: ['0xresp'],
      revealedMessages: new Map(),
      revealedIndices: [],
      nonce: '0x1234567890',
      domain: 'test',
    };

    const result = await verifyBBSProof(proof, pk);

    expect(result.checks.find((c) => c.name === 'proof_structure')?.passed).toBe(false);
  });

  it('fails proof_structure when proofResponses is empty', async () => {
    const pk = makePublicKey(2);
    const proof: BBSSelectiveDisclosureProof = {
      aPrime: '0xa',
      aBar: '0xbar',
      d: '0xd',
      proofC: '0xc',
      proofResponses: [],
      revealedMessages: new Map(),
      revealedIndices: [],
      nonce: '0x1234567890',
      domain: 'test',
    };

    const result = await verifyBBSProof(proof, pk);

    expect(result.checks.find((c) => c.name === 'proof_structure')?.passed).toBe(false);
  });

  it('fails index_bounds when revealed index exceeds messageCount', async () => {
    const pk = makePublicKey(3);
    const proof: BBSSelectiveDisclosureProof = {
      aPrime: '0xa',
      aBar: '0xbar',
      d: '0xd',
      proofC: '0xc',
      proofResponses: ['0xresp'],
      revealedMessages: new Map([[5, '0xmsg5']]),
      revealedIndices: [5],
      nonce: '0x1234567890',
      domain: 'test',
    };

    const result = await verifyBBSProof(proof, pk);

    expect(result.checks.find((c) => c.name === 'index_bounds')?.passed).toBe(false);
  });

  it('fails index_bounds when revealed index is negative', async () => {
    const pk = makePublicKey(3);
    const proof: BBSSelectiveDisclosureProof = {
      aPrime: '0xa',
      aBar: '0xbar',
      d: '0xd',
      proofC: '0xc',
      proofResponses: ['0xresp'],
      revealedMessages: new Map(),
      revealedIndices: [-1],
      nonce: '0x1234567890',
      domain: 'test',
    };

    const result = await verifyBBSProof(proof, pk);

    expect(result.checks.find((c) => c.name === 'index_bounds')?.passed).toBe(false);
  });

  it('fails nonce_freshness when nonce is too short', async () => {
    const pk = makePublicKey(2);
    const proof: BBSSelectiveDisclosureProof = {
      aPrime: '0xa',
      aBar: '0xbar',
      d: '0xd',
      proofC: '0xc',
      proofResponses: ['0xresp'],
      revealedMessages: new Map(),
      revealedIndices: [],
      nonce: '0x1',
      domain: 'test',
    };

    const result = await verifyBBSProof(proof, pk);

    expect(result.checks.find((c) => c.name === 'nonce_freshness')?.passed).toBe(false);
  });

  it('fails nonce_freshness when nonce is empty', async () => {
    const pk = makePublicKey(2);
    const proof: BBSSelectiveDisclosureProof = {
      aPrime: '0xa',
      aBar: '0xbar',
      d: '0xd',
      proofC: '0xc',
      proofResponses: ['0xresp'],
      revealedMessages: new Map(),
      revealedIndices: [],
      nonce: '',
      domain: 'test',
    };

    const result = await verifyBBSProof(proof, pk);

    expect(result.checks.find((c) => c.name === 'nonce_freshness')?.passed).toBe(false);
  });

  it('domain_binding detail includes the domain string', async () => {
    const pk = makePublicKey(2);
    const proof: BBSSelectiveDisclosureProof = {
      aPrime: '0xa',
      aBar: '0xbar',
      d: '0xd',
      proofC: '0xc',
      proofResponses: ['0xresp'],
      revealedMessages: new Map(),
      revealedIndices: [],
      nonce: '0x1234567890',
      domain: 'my.special.domain',
    };

    const result = await verifyBBSProof(proof, pk);

    const domainCheck = result.checks.find((c) => c.name === 'domain_binding');
    expect(domainCheck?.passed).toBe(true);
    expect(domainCheck?.detail).toContain('my.special.domain');
  });

  it('returns valid=false if any check fails', async () => {
    const pk = makePublicKey(2);
    const proof: BBSSelectiveDisclosureProof = {
      aPrime: '',
      aBar: '0xbar',
      d: '0xd',
      proofC: '0xc',
      proofResponses: ['0xresp'],
      revealedMessages: new Map(),
      revealedIndices: [],
      nonce: '0x1234567890',
      domain: 'test',
    };

    const result = await verifyBBSProof(proof, pk);

    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generatePresentation
// ---------------------------------------------------------------------------

describe('generatePresentation', () => {
  beforeEach(() => {
    mockDigest.mockClear();
    mockGetRandomValues.mockClear();
    digestCallCount = 0;
    randomCounter = 0;
  });

  it('generates presentation with domain and challenge', async () => {
    const pk = makePublicKey(2);
    const sig = makeSignature();
    const messages = makeMessages(2);
    const proof = await deriveSelectiveDisclosureProof(sig, pk, messages, [0], 'domain');

    const presentation = await generatePresentation([proof], 'presentation.domain');

    expect(presentation.domain).toBe('presentation.domain');
    expect(presentation.challenge).toBeTruthy();
    expect(presentation.proofs).toHaveLength(1);
    expect(presentation.nonce).toBeTruthy();
    expect(presentation.timestamp).toBeGreaterThan(0);
    expect(presentation.holderBindingProof).toBeUndefined();
  });

  it('includes holder binding proof when holderSecret is provided', async () => {
    const pk = makePublicKey(2);
    const sig = makeSignature();
    const messages = makeMessages(2);
    const proof = await deriveSelectiveDisclosureProof(sig, pk, messages, [0], 'domain');

    const presentation = await generatePresentation(
      [proof],
      'presentation.domain',
      '0xholder_secret',
    );

    expect(presentation.holderBindingProof).toBeDefined();
    expect(presentation.holderBindingProof!.challenge).toBeTruthy();
    expect(presentation.holderBindingProof!.responses).toHaveLength(1);
    expect(presentation.holderBindingProof!.commitment).toBeTruthy();
  });

  it('binds multiple proofs to the same domain', async () => {
    const pk = makePublicKey(2);
    const sig = makeSignature();
    const messages = makeMessages(2);
    const proof1 = await deriveSelectiveDisclosureProof(sig, pk, messages, [0], 'domain1');
    const proof2 = await deriveSelectiveDisclosureProof(sig, pk, messages, [1], 'domain2');

    const presentation = await generatePresentation([proof1, proof2], 'combined.domain');

    expect(presentation.proofs).toHaveLength(2);
    expect(presentation.domain).toBe('combined.domain');
  });

  it('sets timestamp close to current time', async () => {
    const now = Math.floor(Date.now() / 1000);
    const presentation = await generatePresentation([], 'domain');

    expect(presentation.timestamp).toBeGreaterThanOrEqual(now - 1);
    expect(presentation.timestamp).toBeLessThanOrEqual(now + 1);
  });

  it('works with empty proofs array', async () => {
    const presentation = await generatePresentation([], 'empty.domain');

    expect(presentation.proofs).toHaveLength(0);
    expect(presentation.challenge).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// blindCredential / unblindCredential
// ---------------------------------------------------------------------------

describe('blindCredential', () => {
  beforeEach(() => {
    mockDigest.mockClear();
    mockGetRandomValues.mockClear();
    digestCallCount = 0;
    randomCounter = 0;
  });

  it('blinds all messages and returns matching blinding factors', async () => {
    const messages = makeMessages(3);

    const { blindedMessages, blindingFactors } = await blindCredential(messages);

    expect(blindedMessages).toHaveLength(3);
    expect(blindingFactors).toHaveLength(3);
    // Each blinded message should differ from the original
    blindedMessages.forEach((bm, i) => {
      expect(bm).not.toBe(messages[i]);
      expect(bm).toMatch(/^0x[0-9a-f]+$/);
    });
  });

  it('generates unique blinding factors for each message', async () => {
    const messages = makeMessages(3);

    const { blindingFactors } = await blindCredential(messages);

    const unique = new Set(blindingFactors);
    expect(unique.size).toBe(3);
  });

  it('handles empty messages array', async () => {
    const { blindedMessages, blindingFactors } = await blindCredential([]);

    expect(blindedMessages).toHaveLength(0);
    expect(blindingFactors).toHaveLength(0);
  });

  it('handles single message', async () => {
    const { blindedMessages, blindingFactors } = await blindCredential(['0xsingle']);

    expect(blindedMessages).toHaveLength(1);
    expect(blindingFactors).toHaveLength(1);
  });
});

describe('unblindCredential', () => {
  beforeEach(() => {
    mockDigest.mockClear();
    digestCallCount = 0;
    randomCounter = 0;
  });

  it('throws when blinded messages and factors have different lengths', async () => {
    await expect(
      unblindCredential(['0xa', '0xb'], ['0xf1']),
    ).rejects.toThrow('Blinded messages and factors length mismatch');
  });

  it('returns unblinded messages with correct count', async () => {
    const blindedMessages = ['0xblind1', '0xblind2'];
    const blindingFactors = ['0xfactor1', '0xfactor2'];

    const result = await unblindCredential(blindedMessages, blindingFactors);

    expect(result).toHaveLength(2);
    result.forEach((msg) => {
      expect(msg).toMatch(/^0x[0-9a-f]+$/);
    });
  });

  it('handles empty arrays', async () => {
    const result = await unblindCredential([], []);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// createMultiMessageCommitment / verifyMultiMessageCommitment
// ---------------------------------------------------------------------------

describe('createMultiMessageCommitment', () => {
  beforeEach(() => {
    mockDigest.mockClear();
    mockGetRandomValues.mockClear();
    digestCallCount = 0;
    randomCounter = 0;
  });

  it('creates a commitment with correct structure', async () => {
    const messages = makeMessages(3);
    const generators = ['0xgen0', '0xgen1', '0xgen2', '0xgen3'];

    const result = await createMultiMessageCommitment(messages, generators);

    expect(result.commitment).toBeTruthy();
    expect(result.commitment).toMatch(/^0x[0-9a-f]+$/);
    expect(result.blindingFactors).toHaveLength(3);
    expect(result.messageCount).toBe(3);
  });

  it('throws when not enough generators', async () => {
    const messages = makeMessages(5);
    const generators = ['0xgen0', '0xgen1'];

    await expect(
      createMultiMessageCommitment(messages, generators),
    ).rejects.toThrow('Not enough generators: need 5, have 2');
  });

  it('works when generators exceed message count', async () => {
    const messages = makeMessages(2);
    const generators = ['0xgen0', '0xgen1', '0xgen2', '0xgen3'];

    const result = await createMultiMessageCommitment(messages, generators);

    expect(result.messageCount).toBe(2);
    expect(result.blindingFactors).toHaveLength(2);
  });

  it('handles single message', async () => {
    const result = await createMultiMessageCommitment(['0xmsg'], ['0xgen']);

    expect(result.messageCount).toBe(1);
    expect(result.blindingFactors).toHaveLength(1);
  });
});

describe('verifyMultiMessageCommitment', () => {
  beforeEach(() => {
    mockDigest.mockClear();
    mockGetRandomValues.mockClear();
    digestCallCount = 0;
    randomCounter = 0;
  });

  it('returns true for a correctly opened commitment', async () => {
    const messages = makeMessages(3);
    const generators = ['0xgen0', '0xgen1', '0xgen2'];

    const commitment = await createMultiMessageCommitment(messages, generators);
    // Reset digestCallCount so verify's hashToField call uses the same
    // counter value (1) that create used, producing an identical hash.
    digestCallCount = 0;
    const isValid = await verifyMultiMessageCommitment(commitment, messages, generators);

    expect(isValid).toBe(true);
  });

  it('returns false when message count does not match commitment', async () => {
    const messages = makeMessages(3);
    const generators = ['0xgen0', '0xgen1', '0xgen2'];

    const commitment = await createMultiMessageCommitment(messages, generators);

    // Verify with wrong number of messages
    const wrongMessages = makeMessages(2);
    const isValid = await verifyMultiMessageCommitment(commitment, wrongMessages, generators);

    expect(isValid).toBe(false);
  });

  it('returns false when messages differ from committed ones', async () => {
    const messages = makeMessages(2);
    const generators = ['0xgen0', '0xgen1'];

    const commitment = await createMultiMessageCommitment(messages, generators);

    // Tamper with messages
    const tamperedMessages = ['0xtampered0', '0xtampered1'];
    const isValid = await verifyMultiMessageCommitment(commitment, tamperedMessages, generators);

    expect(isValid).toBe(false);
  });

  it('returns false when generators differ from committed ones', async () => {
    const messages = makeMessages(2);
    const generators = ['0xgen0', '0xgen1'];

    const commitment = await createMultiMessageCommitment(messages, generators);

    const wrongGenerators = ['0xwrong0', '0xwrong1'];
    const isValid = await verifyMultiMessageCommitment(commitment, messages, wrongGenerators);

    expect(isValid).toBe(false);
  });
});
