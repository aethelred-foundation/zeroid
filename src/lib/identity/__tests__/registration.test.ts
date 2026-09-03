import {
  buildRegistrationMessage,
  clearIdentityAuthToken,
  getIdentityAuthToken,
  normalizeRecoveryHash,
  storeIdentityAuthToken,
} from "@/lib/identity/registration";

const STORAGE_KEY = "zeroid.identity.authToken";

describe("identity auth token storage", () => {
  const originalZeroIdEnv = process.env.NEXT_PUBLIC_ZEROID_ENV;
  const originalAllowBrowserStorage =
    process.env.NEXT_PUBLIC_ZEROID_ALLOW_BROWSER_TOKEN_STORAGE;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_ZEROID_ENV = originalZeroIdEnv;
    process.env.NEXT_PUBLIC_ZEROID_ALLOW_BROWSER_TOKEN_STORAGE =
      originalAllowBrowserStorage;
    clearIdentityAuthToken();
    window.sessionStorage.clear();
  });

  afterAll(() => {
    if (originalZeroIdEnv === undefined) {
      delete process.env.NEXT_PUBLIC_ZEROID_ENV;
    } else {
      process.env.NEXT_PUBLIC_ZEROID_ENV = originalZeroIdEnv;
    }
    if (originalAllowBrowserStorage === undefined) {
      delete process.env.NEXT_PUBLIC_ZEROID_ALLOW_BROWSER_TOKEN_STORAGE;
    } else {
      process.env.NEXT_PUBLIC_ZEROID_ALLOW_BROWSER_TOKEN_STORAGE =
        originalAllowBrowserStorage;
    }
    clearIdentityAuthToken();
  });

  it("keeps token available from memory without browser persistence by default", () => {
    storeIdentityAuthToken("identity-token");

    expect(getIdentityAuthToken()).toBe("identity-token");
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("uses development session storage only when explicitly enabled", () => {
    process.env.NEXT_PUBLIC_ZEROID_ALLOW_BROWSER_TOKEN_STORAGE = "true";

    storeIdentityAuthToken("identity-token");

    expect(getIdentityAuthToken()).toBe("identity-token");
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe("identity-token");

    clearIdentityAuthToken();
    window.sessionStorage.setItem(STORAGE_KEY, "restored-dev-token");
    expect(getIdentityAuthToken()).toBe("restored-dev-token");
  });

  it("clears memory and browser storage", () => {
    process.env.NEXT_PUBLIC_ZEROID_ALLOW_BROWSER_TOKEN_STORAGE = "true";
    storeIdentityAuthToken("identity-token");

    clearIdentityAuthToken();

    expect(getIdentityAuthToken()).toBeUndefined();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("does not persist bearer tokens to browser storage in production mode", () => {
    process.env.NEXT_PUBLIC_ZEROID_ENV = "production";
    process.env.NEXT_PUBLIC_ZEROID_ALLOW_BROWSER_TOKEN_STORAGE = "true";

    storeIdentityAuthToken("prod-token");

    expect(getIdentityAuthToken()).toBe("prod-token");
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();

    clearIdentityAuthToken();
    window.sessionStorage.setItem(STORAGE_KEY, "stale-prod-token");
    expect(getIdentityAuthToken()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getRegistrationDid — canonical wallet-DID derivation
// ---------------------------------------------------------------------------

import { getRegistrationDid } from "@/lib/identity/registration";

describe("getRegistrationDid", () => {
  const address = "0x1234567890ABCDEF1234567890abcdef12345678" as `0x${string}`;
  const lower = address.toLowerCase();

  it("accepts a canonical wallet DID and lowercases its address segment", () => {
    expect(
      getRegistrationDid({ id: `did:aethelred:testnet:${address}` }, address),
    ).toBe(`did:aethelred:testnet:${lower}`);
  });

  it("rejects the pending placeholder and derives from the wallet address", () => {
    // Regression: "did:aethelred:pending" once registered verbatim, squatting
    // the DID for every wallet while the address lookup 404'd.
    expect(getRegistrationDid({ id: "did:aethelred:pending" }, address)).toBe(
      `did:aethelred:testnet:${lower}`,
    );
  });

  it("rejects short/non-address DIDs and derives instead", () => {
    expect(
      getRegistrationDid({ id: "did:aethelred:testnet:0xabc" }, address),
    ).toBe(`did:aethelred:testnet:${lower}`);
  });

  it("derives from the address when the document has no id", () => {
    expect(getRegistrationDid({}, address)).toBe(
      `did:aethelred:testnet:${lower}`,
    );
  });

  it("throws when no usable id and no address are available", () => {
    expect(() => getRegistrationDid({ id: "did:aethelred:pending" })).toThrow(
      /wallet address is required/i,
    );
  });
});

describe("wallet registration proof message", () => {
  const controller =
    "0x1234567890abcdef1234567890abcdef12345678" as `0x${string}`;
  const did = `did:aethelred:testnet:${controller}`;
  const recoveryHash = "a".repeat(64);

  it("uses the canonical origin/chain/DID/controller/recovery representation", () => {
    expect(
      buildRegistrationMessage({
        did,
        controller,
        recoveryHash,
        origin: "https://zeroid.test",
        chainId: 7332,
      }),
    ).toBe(
      [
        "zeroid.test wants you to register a ZeroID identity with your Ethereum account:",
        controller,
        "",
        "Authorize creation of the wallet-bound ZeroID identity below. This request does not initiate a blockchain transaction.",
        "",
        "URI: https://zeroid.test",
        "Version: 1",
        "Chain ID: 7332",
        `DID: ${did}`,
        `Recovery Hash: ${recoveryHash}`,
        "Purpose: zeroid.identity.registration",
      ].join("\n"),
    );
  });

  it("normalizes the recovery hash before it is signed", () => {
    expect(normalizeRecoveryHash(`0x${"A".repeat(64)}` as `0x${string}`)).toBe(
      "a".repeat(64),
    );
  });

  it("refuses a controller that differs from the DID address", () => {
    expect(() =>
      buildRegistrationMessage({
        did,
        controller:
          "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as `0x${string}`,
        recoveryHash,
        origin: "https://zeroid.test",
        chainId: 7332,
      }),
    ).toThrow(/controller must match/i);
  });
});

// ---------------------------------------------------------------------------
// deriveRegistrationArtifacts — the on-chain arguments and the API digest
// ---------------------------------------------------------------------------

import { keccak256, toBytes } from "viem";
import {
  clearPendingRegistration,
  deriveRegistrationArtifacts,
  getPendingRegistration,
  isRetryableRegistrationCode,
  RETRYABLE_REGISTRATION_CODES,
  storePendingRegistration,
  type BackendIdentityRegistrationPayload,
  type PendingRegistration,
} from "@/lib/identity/registration";
import { createDID } from "@/lib/utils";

describe("deriveRegistrationArtifacts", () => {
  const address = "0x1234567890ABCDEF1234567890abcdef12345678" as `0x${string}`;
  const lower = address.toLowerCase();
  const did = `did:aethelred:testnet:${lower}`;

  it("hashes the UTF-8 DID string exactly as createDID and the API verifier do", () => {
    const { didHash } = deriveRegistrationArtifacts(did, address);
    expect(didHash).toBe(keccak256(toBytes(did)));
    expect(didHash).toBe(createDID(lower, "testnet").hash);
  });

  it("normalizes a mixed-case DID address segment before hashing", () => {
    expect(
      deriveRegistrationArtifacts(`did:aethelred:testnet:${address}`, address)
        .didHash,
    ).toBe(keccak256(toBytes(did)));
  });

  it("binds the recovery commitment to the lowercase recovery controller", () => {
    const recovery =
      "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD" as `0x${string}`;
    const { recoveryHashHex, recoveryHash } = deriveRegistrationArtifacts(
      did,
      recovery,
    );
    expect(recoveryHashHex).toBe(
      keccak256(toBytes(`${did}#recovery:${recovery.toLowerCase()}`)),
    );
    expect(recoveryHash).toBe(recoveryHashHex.slice(2));
    expect(recoveryHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a non-canonical DID", () => {
    expect(() =>
      deriveRegistrationArtifacts("did:aethelred:pending", address),
    ).toThrow(/canonical wallet address/i);
  });
});

describe("registration payload", () => {
  it("carries the transaction hash top-level, never inside metadata", () => {
    const payload: BackendIdentityRegistrationPayload = {
      did: "did:aethelred:testnet:0x1234567890abcdef1234567890abcdef12345678",
      controller: "0x1234567890abcdef1234567890abcdef12345678",
      publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      recoveryHash: "a".repeat(64),
      signature: "0xsig",
      txHash: `0x${"ab".repeat(32)}`,
      metadata: { didDocument: { id: "did" } },
    };
    expect(payload.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(payload.metadata).not.toHaveProperty("txHash");
  });
});

describe("pending registration slot", () => {
  const controller =
    "0x1234567890ABCDEF1234567890abcdef12345678" as `0x${string}`;
  const pending: PendingRegistration = {
    did: `did:aethelred:testnet:${controller.toLowerCase()}`,
    didHash: `0x${"d".repeat(64)}`,
    recoveryHash: "r".repeat(64),
    publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    signature: "0xsig",
    txHash: `0x${"ab".repeat(32)}`,
    didDocument: { id: "did" },
  };

  beforeEach(() => {
    clearPendingRegistration(controller);
    window.sessionStorage.clear();
  });

  it("round-trips per controller regardless of address case", () => {
    storePendingRegistration(controller, pending);
    expect(getPendingRegistration(controller)).toEqual(pending);
    expect(
      getPendingRegistration(controller.toLowerCase() as `0x${string}`),
    ).toEqual(pending);
    expect(
      getPendingRegistration(
        "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as `0x${string}`,
      ),
    ).toBeUndefined();

    clearPendingRegistration(controller);
    expect(getPendingRegistration(controller)).toBeUndefined();
    expect(
      window.sessionStorage.getItem("zeroid.identity.pendingRegistration"),
    ).toBeNull();
  });

  it("survives a page reload through session storage", () => {
    storePendingRegistration(controller, pending);
    const raw = window.sessionStorage.getItem(
      "zeroid.identity.pendingRegistration",
    );
    expect(raw).not.toBeNull();

    // A fresh module instance has an empty in-memory map but the same
    // session storage.
    jest.isolateModules(() => {
      const fresh = require("@/lib/identity/registration");
      expect(fresh.getPendingRegistration(controller)).toEqual(pending);
    });
  });

  it("ignores malformed stored entries", () => {
    window.sessionStorage.setItem(
      "zeroid.identity.pendingRegistration",
      JSON.stringify({ [controller.toLowerCase()]: { txHash: "nope" } }),
    );
    expect(getPendingRegistration(controller)).toBeUndefined();
    window.sessionStorage.setItem(
      "zeroid.identity.pendingRegistration",
      "{not json",
    );
    expect(getPendingRegistration(controller)).toBeUndefined();
  });

  it("tolerates a session storage that throws", () => {
    const setItem = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    const getItem = jest
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    try {
      expect(() => storePendingRegistration(controller, pending)).not.toThrow();
      expect(getPendingRegistration(controller)).toEqual(pending);
      expect(() => clearPendingRegistration(controller)).not.toThrow();
      expect(getPendingRegistration(controller)).toBeUndefined();
    } finally {
      setItem.mockRestore();
      getItem.mockRestore();
    }
  });
});

describe("isRetryableRegistrationCode", () => {
  it("recognizes only the API's not-mined / not-confirmed codes", () => {
    expect(RETRYABLE_REGISTRATION_CODES).toEqual([
      "IDENTITY_REGISTRY_TX_NOT_MINED",
      "IDENTITY_REGISTRY_TX_NOT_CONFIRMED",
    ]);
    expect(isRetryableRegistrationCode("IDENTITY_REGISTRY_TX_NOT_MINED")).toBe(
      true,
    );
    expect(
      isRetryableRegistrationCode("IDENTITY_REGISTRY_TX_NOT_CONFIRMED"),
    ).toBe(true);
    expect(isRetryableRegistrationCode("IDENTITY_REGISTRY_TX_REVERTED")).toBe(
      false,
    );
    expect(isRetryableRegistrationCode(undefined)).toBe(false);
  });
});
