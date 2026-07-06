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
