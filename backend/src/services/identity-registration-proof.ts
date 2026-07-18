import {
  getAddress,
  hashMessage,
  Signature,
  SigningKey,
  verifyMessage,
} from "ethers";

const WALLET_DID_PATTERN =
  /^did:aethelred:(mainnet|testnet|devnet):(0x[a-fA-F0-9]{40})$/;
const RECOVERY_HASH_PATTERN = /^[a-fA-F0-9]{64}$/;
const CANONICAL_SIGNATURE_PATTERN = /^0x[a-fA-F0-9]{128}(1b|1c)$/i;
const SECP256K1_HALF_ORDER = BigInt(
  "0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0",
);

export interface WalletRegistrationProofInput {
  did: string;
  controller: string;
  publicKey: string;
  recoveryHash: string;
  signature: string;
}

export interface VerifiedWalletRegistrationProof {
  did: string;
  controller: string;
  publicKey: string;
  recoveryHash: string;
}

export class IdentityRegistrationProofError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "IdentityRegistrationProofError";
  }
}

/**
 * Produce the only DID representation accepted by the wallet-registration
 * proof. Keeping this normalization in the service layer prevents callers
 * that bypass Express validation from creating a differently-cased alias.
 */
export function normalizeWalletRegistrationDid(did: string): string {
  const match = WALLET_DID_PATTERN.exec(did);
  if (!match) {
    throw new IdentityRegistrationProofError(
      "Invalid wallet identity DID",
      "IDENTITY_INVALID_DID",
      400,
    );
  }

  let address: string;
  try {
    address = getAddress(match[2].toLowerCase()).toLowerCase();
  } catch {
    throw new IdentityRegistrationProofError(
      "Invalid wallet identity DID",
      "IDENTITY_INVALID_DID",
      400,
    );
  }

  return `did:aethelred:${match[1]}:${address}`;
}

/**
 * Canonical registration message shared with the browser implementation.
 * All interpolated values have strict, newline-free formats, so two fields
 * cannot be reinterpreted as one another.
 */
export function buildWalletRegistrationMessage(input: {
  origin: URL;
  chainId: number;
  did: string;
  controller: string;
  recoveryHash: string;
}): string {
  return [
    `${input.origin.host} wants you to register a ZeroID identity with your Ethereum account:`,
    input.controller,
    "",
    "Authorize creation of the wallet-bound ZeroID identity below. This request does not initiate a blockchain transaction.",
    "",
    `URI: ${input.origin.origin}`,
    "Version: 1",
    `Chain ID: ${input.chainId}`,
    `DID: ${input.did}`,
    `Recovery Hash: ${input.recoveryHash}`,
    "Purpose: zeroid.identity.registration",
  ].join("\n");
}

/**
 * Rebuild and verify a wallet registration proof without trusting message
 * text supplied by the client. The recovered signer must be the top-level
 * controller and the address encoded in the DID; the submitted public key
 * must be the exact uncompressed key recovered from the same signature.
 */
export function verifyWalletRegistrationProof(
  input: WalletRegistrationProofInput,
): VerifiedWalletRegistrationProof {
  const did = normalizeWalletRegistrationDid(input.did);
  const didController = did.slice(did.lastIndexOf(":") + 1);
  const controller = normalizeController(input.controller);
  const recoveryHash = normalizeRecoveryHash(input.recoveryHash);
  const signature = normalizeCanonicalSignature(input.signature);
  const origin = resolveRegistrationOrigin();
  const chainId = resolveRegistrationChainId();

  if (controller !== didController) {
    throw invalidProof(
      "Wallet controller does not match the address encoded in the DID",
    );
  }

  const message = buildWalletRegistrationMessage({
    origin,
    chainId,
    did,
    controller,
    recoveryHash,
  });

  let recoveredController: string;
  let recoveredPublicKey: string;
  try {
    const parsedSignature = Signature.from(signature);
    if (BigInt(parsedSignature.s) > SECP256K1_HALF_ORDER) {
      throw new Error("Non-canonical signature");
    }

    recoveredController = verifyMessage(message, signature).toLowerCase();
    const publicKeyHex = SigningKey.recoverPublicKey(
      hashMessage(message),
      parsedSignature,
    );
    recoveredPublicKey = Buffer.from(publicKeyHex.slice(2), "hex").toString(
      "base64",
    );
  } catch {
    throw invalidProof("Wallet registration signature is invalid");
  }

  if (
    recoveredController !== controller ||
    recoveredController !== didController
  ) {
    throw invalidProof(
      "Wallet registration signature does not match the identity controller",
    );
  }

  const submittedPublicKey = normalizeSubmittedPublicKey(input.publicKey);
  if (submittedPublicKey !== recoveredPublicKey) {
    throw invalidProof(
      "Wallet registration public key does not match the signed controller",
    );
  }

  return {
    did,
    controller,
    publicKey: recoveredPublicKey,
    recoveryHash,
  };
}

function normalizeController(value: string): string {
  try {
    return getAddress(value.toLowerCase()).toLowerCase();
  } catch {
    throw invalidProof("Wallet registration controller is invalid");
  }
}

function normalizeRecoveryHash(value: string): string {
  if (!RECOVERY_HASH_PATTERN.test(value)) {
    throw new IdentityRegistrationProofError(
      "Invalid recovery hash format",
      "IDENTITY_INVALID_RECOVERY_HASH",
      400,
    );
  }
  return value.toLowerCase();
}

function normalizeCanonicalSignature(value: string): string {
  if (!CANONICAL_SIGNATURE_PATTERN.test(value)) {
    throw invalidProof("Wallet registration signature is invalid");
  }
  return value.toLowerCase();
}

function normalizeSubmittedPublicKey(value: string): string {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw invalidProof("Wallet registration public key is invalid");
  }

  const decoded = Buffer.from(value, "base64");
  if (
    decoded.length !== 65 ||
    decoded[0] !== 0x04 ||
    decoded.toString("base64") !== value
  ) {
    throw invalidProof("Wallet registration public key is invalid");
  }
  return value;
}

function resolveRegistrationOrigin(): URL {
  const configured = process.env.ZEROID_AUTH_ORIGIN?.trim();
  if (!configured && process.env.NODE_ENV === "production") {
    throw configurationError();
  }

  let origin: URL;
  try {
    origin = new URL(configured || "http://localhost:3003");
  } catch {
    throw configurationError();
  }

  if (
    !["http:", "https:"].includes(origin.protocol) ||
    (process.env.NODE_ENV === "production" && origin.protocol !== "https:") ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    (origin.pathname !== "/" && origin.pathname !== "")
  ) {
    throw configurationError();
  }

  return origin;
}

function resolveRegistrationChainId(): number {
  const chainId = Number(process.env.AETHELRED_CHAIN_ID ?? "7332");
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw configurationError();
  }
  return chainId;
}

function invalidProof(message: string): IdentityRegistrationProofError {
  return new IdentityRegistrationProofError(
    message,
    "IDENTITY_REGISTRATION_PROOF_INVALID",
    401,
  );
}

function configurationError(): IdentityRegistrationProofError {
  return new IdentityRegistrationProofError(
    "Wallet registration is not configured",
    "IDENTITY_REGISTRATION_NOT_CONFIGURED",
    503,
  );
}
