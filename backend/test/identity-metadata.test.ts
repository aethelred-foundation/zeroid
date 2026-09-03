import {
  buildClientIdentityMetadata,
  CLIENT_WRITABLE_IDENTITY_METADATA_KEYS,
  findNonClientWritableIdentityMetadataKey,
} from '../src/utils/identity-metadata';

const CONTROLLER = '0x1234567890abcdef1234567890abcdef12345678';

describe('identity metadata allowlist', () => {
  it('only allows avatarUri and didDocument from the client', () => {
    expect([...CLIENT_WRITABLE_IDENTITY_METADATA_KEYS]).toEqual([
      'avatarUri',
      'didDocument',
    ]);
    expect(
      findNonClientWritableIdentityMetadataKey({
        avatarUri: 'https://cdn.example/a.png',
        didDocument: { id: 'did:aethelred:testnet:' + CONTROLLER },
      }),
    ).toBeNull();
  });

  it.each(['txHash', 'didHash', 'controller', 'governmentVerified'])(
    'rejects client-supplied %s',
    (key) => {
      expect(findNonClientWritableIdentityMetadataKey({ [key]: 'x' })).toBe(key);
    },
  );

  it('drops registry evidence keys from legacy metadata and re-injects the controller', () => {
    expect(
      buildClientIdentityMetadata(
        {
          avatarUri: 'https://cdn.example/a.png',
          didDocument: { id: 'did' },
          txHash: `0x${'1'.repeat(64)}`,
          didHash: `0x${'2'.repeat(64)}`,
          controller: '0xattacker',
        },
        CONTROLLER,
      ),
    ).toEqual({
      avatarUri: 'https://cdn.example/a.png',
      didDocument: { id: 'did' },
      controller: CONTROLLER,
    });
  });

  it('tolerates non-object metadata', () => {
    expect(buildClientIdentityMetadata(undefined, CONTROLLER)).toEqual({
      controller: CONTROLLER,
    });
    expect(buildClientIdentityMetadata(['x'], CONTROLLER)).toEqual({
      controller: CONTROLLER,
    });
  });
});
