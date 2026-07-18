import { walletDidSchema, registerIdentitySchema } from '../src/middleware/validation';

describe('walletDidSchema', () => {
  const address = '0x1234567890ABCDEF1234567890abcdef12345678';

  it('accepts canonical wallet DIDs and lowercases them', () => {
    const parsed = walletDidSchema.parse(`did:aethelred:testnet:${address}`);
    expect(parsed).toBe(`did:aethelred:testnet:${address.toLowerCase()}`);
  });

  it.each(['mainnet', 'testnet', 'devnet'])('accepts the %s network', (network) => {
    expect(() =>
      walletDidSchema.parse(`did:aethelred:${network}:${address.toLowerCase()}`),
    ).not.toThrow();
  });

  it('rejects the placeholder DID that once squatted registration', () => {
    // Regression: "did:aethelred:pending" registered verbatim, blocking every
    // wallet with 409 conflicts while the address lookup 404'd.
    expect(() => walletDidSchema.parse('did:aethelred:pending')).toThrow();
  });

  it('rejects non-address-bound DIDs', () => {
    expect(() => walletDidSchema.parse('did:aethelred:testnet:0xabc')).toThrow();
    expect(() => walletDidSchema.parse('did:aethelred:agent:agent-1')).toThrow();
    expect(() => walletDidSchema.parse('did:aethelred:alice')).toThrow();
  });

  it('is enforced by registerIdentitySchema', () => {
    const base = {
      controller: address,
      publicKey: Buffer.from('a-valid-public-key-that-is-long-enough').toString('base64'),
      recoveryHash: 'a'.repeat(64),
      signature: `0x${'0'.repeat(128)}1b`,
    };
    expect(() =>
      registerIdentitySchema.parse({ ...base, did: 'did:aethelred:pending' }),
    ).toThrow();
    const ok = registerIdentitySchema.parse({
      ...base,
      did: `did:aethelred:testnet:${address}`,
    });
    expect(ok.did).toBe(`did:aethelred:testnet:${address.toLowerCase()}`);
    expect(ok.controller).toBe(address.toLowerCase());
    expect(ok.signature).toBe(`0x${'0'.repeat(128)}1b`);
  });

  it('requires an explicit canonical wallet signature', () => {
    const base = {
      did: `did:aethelred:testnet:${address}`,
      controller: address,
      publicKey: Buffer.from('a-valid-public-key-that-is-long-enough').toString('base64'),
      recoveryHash: 'a'.repeat(64),
    };

    expect(() => registerIdentitySchema.parse(base)).toThrow();
    expect(() =>
      registerIdentitySchema.parse({ ...base, signature: '0x1234' }),
    ).toThrow();
    expect(() =>
      registerIdentitySchema.parse({
        ...base,
        signature: `0x${'0'.repeat(128)}00`,
      }),
    ).toThrow();
  });
});
