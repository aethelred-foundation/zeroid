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

  const txHash = `0x${'AB'.repeat(32)}`;

  it('is enforced by registerIdentitySchema', () => {
    const base = {
      controller: address,
      publicKey: Buffer.from('a-valid-public-key-that-is-long-enough').toString('base64'),
      recoveryHash: 'a'.repeat(64),
      signature: `0x${'0'.repeat(128)}1b`,
      txHash,
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
    expect(ok.txHash).toBe(txHash.toLowerCase());
  });

  it('requires the registry transaction hash and lowercases it', () => {
    const base = {
      did: `did:aethelred:testnet:${address}`,
      controller: address,
      publicKey: Buffer.from('a-valid-public-key-that-is-long-enough').toString('base64'),
      recoveryHash: 'a'.repeat(64),
      signature: `0x${'0'.repeat(128)}1b`,
    };

    expect(() => registerIdentitySchema.parse(base)).toThrow();
    for (const bad of ['', '0x1234', `0x${'a'.repeat(63)}`, `${'a'.repeat(64)}`, `0x${'g'.repeat(64)}`]) {
      expect(() => registerIdentitySchema.parse({ ...base, txHash: bad })).toThrow();
    }
    expect(registerIdentitySchema.parse({ ...base, txHash }).txHash).toBe(
      txHash.toLowerCase(),
    );
  });

  it('requires an explicit canonical wallet signature', () => {
    const base = {
      did: `did:aethelred:testnet:${address}`,
      controller: address,
      publicKey: Buffer.from('a-valid-public-key-that-is-long-enough').toString('base64'),
      recoveryHash: 'a'.repeat(64),
      txHash,
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

  it.each([
    'verified_oidc_claims',
    'verifiedOIDCClaims',
    'verifiedClaims',
    'verified_claims',
    'verified-claims',
    'governmentVerification',
    'kyc_level',
    'tee_attestation_id',
    'controller',
    'futureAuthoritativeNamespace',
  ])('rejects the non-client-writable metadata key %s', (reservedKey) => {
    const payload = {
      did: `did:aethelred:testnet:${address}`,
      controller: address,
      publicKey: Buffer.from('a-valid-public-key-that-is-long-enough').toString('base64'),
      recoveryHash: 'a'.repeat(64),
      signature: `0x${'0'.repeat(128)}1b`,
      txHash,
      metadata: {
        [reservedKey]: { name: 'attacker-controlled' },
      },
    };

    expect(() => registerIdentitySchema.parse(payload)).toThrow();
  });

  it('accepts the explicit client metadata allowlist', () => {
    const parsed = registerIdentitySchema.parse({
      did: `did:aethelred:testnet:${address}`,
      controller: address,
      publicKey: Buffer.from('a-valid-public-key-that-is-long-enough').toString('base64'),
      recoveryHash: 'a'.repeat(64),
      signature: `0x${'0'.repeat(128)}1b`,
      txHash,
      metadata: {
        avatarUri: 'https://example.test/avatar.png',
        didDocument: { id: `did:aethelred:testnet:${address.toLowerCase()}` },
      },
    });

    expect(parsed.metadata).toEqual({
      avatarUri: 'https://example.test/avatar.png',
      didDocument: { id: `did:aethelred:testnet:${address.toLowerCase()}` },
    });
  });

  it.each(['didHash', 'txHash'])(
    'no longer accepts registry evidence key %s in client metadata',
    (key) => {
      // Registry evidence is derived server-side by the verifier from the
      // top-level txHash; a client value would be unverified.
      expect(() =>
        registerIdentitySchema.parse({
          did: `did:aethelred:testnet:${address}`,
          controller: address,
          publicKey: Buffer.from('a-valid-public-key-that-is-long-enough').toString('base64'),
          recoveryHash: 'a'.repeat(64),
          signature: `0x${'0'.repeat(128)}1b`,
          txHash,
          metadata: { [key]: `0x${'a'.repeat(64)}` },
        }),
      ).toThrow();
    },
  );
});
