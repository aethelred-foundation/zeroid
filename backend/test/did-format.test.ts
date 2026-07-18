jest.mock('../src/runtime', () => ({
  logger: {
    warn: jest.fn(),
  },
}));

import { didSchema } from '../src/middleware/validation';
import { isAethelredDid } from '../src/utils/did';

describe('Aethelred DID format', () => {
  const validDids = [
    'did:aethelred:alice',
    'did:aethelred:testnet:0xabc123',
    'did:aethelred:issuer:alpha',
    'did:aethelred:agent:edge-node_1',
  ];

  const invalidDids = [
    '',
    'not-a-did',
    'did:wrong:method',
    'did:aethelred:',
    'did:aethelred:test:',
    'did:aethelred:test::alice',
    'did:aethelred:a b',
    'did:aethelred:test/../../etc/passwd',
    'did:aethelred:test\x00null',
  ];

  it.each(validDids)('accepts valid DID: %s', (did) => {
    expect(isAethelredDid(did)).toBe(true);
    expect(didSchema.safeParse(did).success).toBe(true);
  });

  it.each(invalidDids)('rejects invalid DID: %s', (did) => {
    expect(isAethelredDid(did)).toBe(false);
    expect(didSchema.safeParse(did).success).toBe(false);
  });
});
