/**
 * Registry evidence (transaction hash, DID hash, block, controller) is derived
 * by the server-side verifier and stored in the identity's registry* columns.
 * It is never accepted from the client, so those keys are not listed here.
 */
export const CLIENT_WRITABLE_IDENTITY_METADATA_KEYS = [
  'avatarUri',
  'didDocument',
] as const;

const CLIENT_WRITABLE_IDENTITY_METADATA_KEY_SET = new Set<string>(
  CLIENT_WRITABLE_IDENTITY_METADATA_KEYS,
);

/**
 * Identity metadata is an explicit allowlist. This keeps present and future
 * government, TEE, assurance, controller, and OIDC namespaces on the trusted
 * server side of the boundary instead of relying on an incomplete denylist.
 */
export function findNonClientWritableIdentityMetadataKey(
  metadata: Record<string, unknown>,
): string | null {
  for (const key of Object.keys(metadata)) {
    if (!CLIENT_WRITABLE_IDENTITY_METADATA_KEY_SET.has(key)) {
      return key;
    }
  }

  return null;
}

/**
 * Remove legacy non-client metadata before persisting a profile update. The
 * canonical controller is restored by the service from the address-bound DID,
 * never from the request body.
 */
export function buildClientIdentityMetadata(
  metadata: unknown,
  controller: string,
): Record<string, unknown> {
  const source =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const clientMetadata: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (CLIENT_WRITABLE_IDENTITY_METADATA_KEY_SET.has(key)) {
      clientMetadata[key] = value;
    }
  }

  return {
    ...clientMetadata,
    controller,
  };
}
