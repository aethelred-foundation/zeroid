import {
  clearIdentityAuthToken,
  getIdentityAuthToken,
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
