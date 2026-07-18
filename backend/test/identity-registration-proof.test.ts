import { Wallet } from "ethers";

import {
  buildWalletRegistrationMessage,
  verifyWalletRegistrationProof,
} from "../src/services/identity-registration-proof";

const ORIGINAL_ENV = { ...process.env };
const ORIGIN = "https://zeroid.test";
const CHAIN_ID = 7332;

function walletPublicKey(wallet: Wallet): string {
  return Buffer.from(wallet.signingKey.publicKey.slice(2), "hex").toString(
    "base64",
  );
}

function messageFor(input: {
  did: string;
  controller: string;
  recoveryHash: string;
}): string {
  return [
    "zeroid.test wants you to register a ZeroID identity with your Ethereum account:",
    input.controller,
    "",
    "Authorize creation of the wallet-bound ZeroID identity below. This request does not initiate a blockchain transaction.",
    "",
    "URI: https://zeroid.test",
    "Version: 1",
    "Chain ID: 7332",
    `DID: ${input.did}`,
    `Recovery Hash: ${input.recoveryHash}`,
    "Purpose: zeroid.identity.registration",
  ].join("\n");
}

async function signedRegistration(
  wallet: Wallet,
  recoveryHash = "a".repeat(64),
) {
  const controller = wallet.address.toLowerCase();
  const did = `did:aethelred:testnet:${controller}`;
  const message = messageFor({ did, controller, recoveryHash });
  return {
    did,
    controller,
    publicKey: walletPublicKey(wallet),
    recoveryHash,
    signature: await wallet.signMessage(message),
  };
}

describe("wallet identity registration proof", () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "test",
      ZEROID_AUTH_ORIGIN: ORIGIN,
      AETHELRED_CHAIN_ID: String(CHAIN_ID),
    };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("accepts the canonical signed registration and recovered public key", async () => {
    const registration = await signedRegistration(Wallet.createRandom());

    expect(
      buildWalletRegistrationMessage({
        origin: new URL(ORIGIN),
        chainId: CHAIN_ID,
        did: registration.did,
        controller: registration.controller,
        recoveryHash: registration.recoveryHash,
      }),
    ).toBe(
      messageFor({
        did: registration.did,
        controller: registration.controller,
        recoveryHash: registration.recoveryHash,
      }),
    );
    expect(verifyWalletRegistrationProof(registration)).toEqual({
      did: registration.did,
      controller: registration.controller,
      publicKey: registration.publicKey,
      recoveryHash: registration.recoveryHash,
    });
  });

  it("rejects a signature produced by a different wallet", async () => {
    const controller = Wallet.createRandom();
    const attacker = Wallet.createRandom();
    const registration = await signedRegistration(controller);

    registration.signature = await attacker.signMessage(
      messageFor(registration),
    );
    registration.publicKey = walletPublicKey(attacker);

    expect(() => verifyWalletRegistrationProof(registration)).toThrow(
      expect.objectContaining({
        code: "IDENTITY_REGISTRATION_PROOF_INVALID",
        statusCode: 401,
      }),
    );
  });

  it("rejects recovery-hash substitution after signing", async () => {
    const registration = await signedRegistration(Wallet.createRandom());

    expect(() =>
      verifyWalletRegistrationProof({
        ...registration,
        recoveryHash: "b".repeat(64),
      }),
    ).toThrow(
      expect.objectContaining({
        code: "IDENTITY_REGISTRATION_PROOF_INVALID",
        statusCode: 401,
      }),
    );
  });

  it("rejects a submitted public key not recovered from the signature", async () => {
    const registration = await signedRegistration(Wallet.createRandom());

    expect(() =>
      verifyWalletRegistrationProof({
        ...registration,
        publicKey: walletPublicKey(Wallet.createRandom()),
      }),
    ).toThrow(
      expect.objectContaining({
        code: "IDENTITY_REGISTRATION_PROOF_INVALID",
        statusCode: 401,
      }),
    );
  });

  it("rejects malformed or non-canonical signature encodings", async () => {
    const registration = await signedRegistration(Wallet.createRandom());

    for (const signature of [
      "0x1234",
      `${registration.signature.slice(0, -2)}00`,
      registration.signature.slice(0, -2),
    ]) {
      expect(() =>
        verifyWalletRegistrationProof({ ...registration, signature }),
      ).toThrow(
        expect.objectContaining({
          code: "IDENTITY_REGISTRATION_PROOF_INVALID",
          statusCode: 401,
        }),
      );
    }
  });

  it("binds the signature to the configured production origin and chain", async () => {
    const registration = await signedRegistration(Wallet.createRandom());

    process.env.ZEROID_AUTH_ORIGIN = "https://other-zeroid.test";
    expect(() => verifyWalletRegistrationProof(registration)).toThrow(
      expect.objectContaining({
        code: "IDENTITY_REGISTRATION_PROOF_INVALID",
      }),
    );

    process.env.ZEROID_AUTH_ORIGIN = ORIGIN;
    process.env.AETHELRED_CHAIN_ID = "7331";
    expect(() => verifyWalletRegistrationProof(registration)).toThrow(
      expect.objectContaining({
        code: "IDENTITY_REGISTRATION_PROOF_INVALID",
      }),
    );
  });
});
