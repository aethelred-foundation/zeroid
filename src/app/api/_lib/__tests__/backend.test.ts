import {
  BackendProxyConfigError,
  getBackendApiBaseUrl,
} from "@/app/api/_lib/backend";

const originalNodeEnv = process.env.NODE_ENV;
const originalZeroIdEnv = process.env.ZEROID_ENV;
const originalBackendUrl = process.env.ZEROID_BACKEND_API_URL;
const originalPlaintextGate = process.env.ZEROID_ALLOW_PLAINTEXT_HTTP;
const originalChainEnv = process.env.NEXT_PUBLIC_CHAIN_ENV;

function restoreEnvironment() {
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  };

  restore("NODE_ENV", originalNodeEnv);
  restore("ZEROID_ENV", originalZeroIdEnv);
  restore("ZEROID_BACKEND_API_URL", originalBackendUrl);
  restore("ZEROID_ALLOW_PLAINTEXT_HTTP", originalPlaintextGate);
  restore("NEXT_PUBLIC_CHAIN_ENV", originalChainEnv);
}

describe("production backend URL", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "production";
    delete process.env.ZEROID_ENV;
    delete process.env.ZEROID_ALLOW_PLAINTEXT_HTTP;
    process.env.NEXT_PUBLIC_CHAIN_ENV = "testnet";
  });

  afterEach(restoreEnvironment);

  it("rejects plaintext unless the testnet gate is explicit", () => {
    process.env.ZEROID_BACKEND_API_URL = "http://127.0.0.1:4003";

    expect(() => getBackendApiBaseUrl()).toThrow(
      new BackendProxyConfigError(
        "Backend API URL must use HTTPS in production",
      ),
    );
  });

  it("permits the exact configured backend URL with the testnet gate", () => {
    process.env.ZEROID_ALLOW_PLAINTEXT_HTTP = "true";
    process.env.ZEROID_BACKEND_API_URL = "http://127.0.0.1:4003/v1/";

    expect(getBackendApiBaseUrl()).toBe("http://127.0.0.1:4003/v1");
  });

  it("does not permit the plaintext gate outside testnet", () => {
    process.env.ZEROID_ALLOW_PLAINTEXT_HTTP = "true";
    process.env.NEXT_PUBLIC_CHAIN_ENV = "mainnet";
    process.env.ZEROID_BACKEND_API_URL = "http://127.0.0.1:4003";

    expect(() => getBackendApiBaseUrl()).toThrow(
      new BackendProxyConfigError(
        "Backend API URL must use HTTPS in production",
      ),
    );
  });

  it("still rejects credentials when the testnet gate is enabled", () => {
    process.env.ZEROID_ALLOW_PLAINTEXT_HTTP = "true";
    process.env.ZEROID_BACKEND_API_URL =
      "http://operator:secret@127.0.0.1:4003";

    expect(() => getBackendApiBaseUrl()).toThrow(
      new BackendProxyConfigError(
        "Backend API URL must not include credentials, query, or fragment",
      ),
    );
  });
});
