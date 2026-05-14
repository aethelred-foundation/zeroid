export const AETHELRED_DID_PATTERN =
  /^did:aethelred:[A-Za-z0-9._-]+(?::[A-Za-z0-9._-]+)*$/;

export function isAethelredDid(value: string): boolean {
  return AETHELRED_DID_PATTERN.test(value);
}
