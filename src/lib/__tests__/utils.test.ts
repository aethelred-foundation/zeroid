/**
 * Tests for @/lib/utils
 *
 * Covers every exported function with edge-case, boundary, and
 * error-path tests targeting 100 % branch and line coverage.
 */

import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNow, fromUnixTime } from "date-fns";
import { keccak256, toHex, toBytes } from "viem";

import {
  cn,
  formatAddress,
  formatHash,
  isValidAddress,
  isValidBytes32,
  formatDate,
  formatDateTime,
  formatRelativeTime,
  isExpired,
  createDID,
  parseDID,
  hashDID,
  formatNumber,
  formatPercent,
  copyToClipboard,
  stringToBytes32,
  numberToHex,
  sleep,
  withRetry,
  withTimeout,
} from "@/lib/utils";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock("clsx", () => ({
  clsx: jest.fn((...args: unknown[]) =>
    args.flat(Infinity).filter(Boolean).join(" "),
  ),
}));

jest.mock("tailwind-merge", () => ({
  twMerge: jest.fn((s: string) => s),
}));

jest.mock("date-fns", () => ({
  format: jest.fn(),
  formatDistanceToNow: jest.fn(),
  fromUnixTime: jest.fn((ts: number) => new Date(ts * 1000)),
}));

jest.mock("viem", () => ({
  keccak256: jest.fn(() => "0x" + "ab".repeat(32)),
  toHex: jest.fn((v: bigint) => `0x${v.toString(16)}`),
  toBytes: jest.fn((v: string) => new Uint8Array(Buffer.from(v))),
}));

jest.mock("@/config/constants", () => ({
  DID_METHOD_PREFIX: "did:aethelred",
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockedFormat = format as jest.MockedFunction<typeof format>;
const mockedFormatDistanceToNow = formatDistanceToNow as jest.MockedFunction<
  typeof formatDistanceToNow
>;
const mockedKeccak256 = keccak256 as jest.MockedFunction<typeof keccak256>;
const mockedToHex = toHex as jest.MockedFunction<typeof toHex>;

beforeEach(() => {
  jest.clearAllMocks();
});

// ============================================================================
// cn
// ============================================================================

describe("cn", () => {
  it("merges class names via clsx then twMerge", () => {
    const result = cn("px-4", "py-2");
    expect(clsx).toHaveBeenCalledWith(["px-4", "py-2"]);
    expect(twMerge).toHaveBeenCalled();
    expect(typeof result).toBe("string");
  });

  it("handles empty inputs", () => {
    const result = cn();
    expect(result).toBeDefined();
  });

  it("filters falsy values", () => {
    cn("a", false && "b", undefined, null, "c");
    expect(clsx).toHaveBeenCalled();
  });
});

// ============================================================================
// formatAddress
// ============================================================================

describe("formatAddress", () => {
  const fullAddress = "0x1234567890abcdef1234567890abcdef12345678";

  it("truncates a full-length address", () => {
    expect(formatAddress(fullAddress)).toBe("0x1234...5678");
  });

  it("returns empty string for falsy input", () => {
    expect(formatAddress("")).toBe("");
  });

  it("returns the address as-is when shorter than prefix + suffix + 3", () => {
    expect(formatAddress("0x1234", 4, 2)).toBe("0x1234");
  });

  it("respects custom prefix and suffix lengths", () => {
    expect(formatAddress(fullAddress, 8, 6)).toBe("0x123456...345678");
  });

  it("returns address as-is when length equals threshold", () => {
    // prefixLen=6, suffixLen=4, threshold = 6+4+3 = 13
    // a string of exactly 13 chars should be returned as-is
    const short = "0x12345678901"; // 13 chars
    expect(formatAddress(short)).toBe(short);
  });
});

// ============================================================================
// formatHash
// ============================================================================

describe("formatHash", () => {
  it("delegates to formatAddress with (hash, 6, 4)", () => {
    const hash = "0x" + "aa".repeat(32);
    const result = formatHash(hash);
    expect(result).toBe(`0xaaaa...aaaa`);
  });
});

// ============================================================================
// isValidAddress
// ============================================================================

describe("isValidAddress", () => {
  it("returns true for a valid 40-hex address", () => {
    expect(isValidAddress("0x" + "aA".repeat(20))).toBe(true);
  });

  it("returns false when missing 0x prefix", () => {
    expect(isValidAddress("aa".repeat(20))).toBe(false);
  });

  it("returns false for wrong length (too short)", () => {
    expect(isValidAddress("0x1234")).toBe(false);
  });

  it("returns false for wrong length (too long)", () => {
    expect(isValidAddress("0x" + "aa".repeat(21))).toBe(false);
  });

  it("returns false for non-hex characters", () => {
    expect(isValidAddress("0x" + "zz".repeat(20))).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isValidAddress("")).toBe(false);
  });
});

// ============================================================================
// isValidBytes32
// ============================================================================

describe("isValidBytes32", () => {
  it("returns true for a valid 64-hex bytes32", () => {
    expect(isValidBytes32("0x" + "ab".repeat(32))).toBe(true);
  });

  it("returns false when missing 0x prefix", () => {
    expect(isValidBytes32("ab".repeat(32))).toBe(false);
  });

  it("returns false for wrong length", () => {
    expect(isValidBytes32("0x1234")).toBe(false);
  });

  it("returns false for non-hex characters", () => {
    expect(isValidBytes32("0x" + "gg".repeat(32))).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isValidBytes32("")).toBe(false);
  });
});

// ============================================================================
// formatDate
// ============================================================================

describe("formatDate", () => {
  it("formats a valid timestamp with default pattern", () => {
    mockedFormat.mockReturnValue("Mar 15, 2026");
    expect(formatDate(1773763200)).toBe("Mar 15, 2026");
    expect(fromUnixTime).toHaveBeenCalledWith(1773763200);
    expect(format).toHaveBeenCalledWith(expect.any(Date), "MMM d, yyyy");
  });

  it("uses a custom pattern when provided", () => {
    mockedFormat.mockReturnValue("2026-03-15");
    expect(formatDate(1773763200, "yyyy-MM-dd")).toBe("2026-03-15");
    expect(format).toHaveBeenCalledWith(expect.any(Date), "yyyy-MM-dd");
  });

  it('returns "N/A" for 0 timestamp', () => {
    expect(formatDate(0)).toBe("N/A");
  });

  it('returns "N/A" for negative timestamp', () => {
    expect(formatDate(-1)).toBe("N/A");
  });

  it('returns "N/A" for falsy (NaN cast to 0-ish) timestamp', () => {
    // Passing undefined coerced to 0 scenario
    expect(formatDate(0 as any)).toBe("N/A");
  });

  it('returns "Invalid date" when format throws', () => {
    mockedFormat.mockImplementation(() => {
      throw new Error("bad date");
    });
    expect(formatDate(999999999)).toBe("Invalid date");
  });
});

// ============================================================================
// formatDateTime
// ============================================================================

describe("formatDateTime", () => {
  it("calls formatDate with the date-time pattern", () => {
    mockedFormat.mockReturnValue("Mar 15, 2026 at 2:30 PM");
    const result = formatDateTime(1773763200);
    expect(result).toBe("Mar 15, 2026 at 2:30 PM");
    expect(format).toHaveBeenCalledWith(
      expect.any(Date),
      "MMM d, yyyy 'at' h:mm a",
    );
  });
});

// ============================================================================
// formatRelativeTime
// ============================================================================

describe("formatRelativeTime", () => {
  it("returns a relative time string for a valid timestamp", () => {
    mockedFormatDistanceToNow.mockReturnValue("3 hours ago");
    expect(formatRelativeTime(1773763200)).toBe("3 hours ago");
    expect(formatDistanceToNow).toHaveBeenCalledWith(expect.any(Date), {
      addSuffix: true,
    });
  });

  it('returns "N/A" for 0 timestamp', () => {
    expect(formatRelativeTime(0)).toBe("N/A");
  });

  it('returns "N/A" for negative timestamp', () => {
    expect(formatRelativeTime(-100)).toBe("N/A");
  });

  it('returns "Unknown" when formatDistanceToNow throws', () => {
    mockedFormatDistanceToNow.mockImplementation(() => {
      throw new Error("fail");
    });
    expect(formatRelativeTime(1773763200)).toBe("Unknown");
  });
});

// ============================================================================
// isExpired
// ============================================================================

describe("isExpired", () => {
  it("returns true when current time is past the expiry", () => {
    const pastTimestamp = Math.floor(Date.now() / 1000) - 3600;
    expect(isExpired(pastTimestamp)).toBe(true);
  });

  it("returns false when current time is before the expiry", () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 3600;
    expect(isExpired(futureTimestamp)).toBe(false);
  });

  it("returns true when current time equals the expiry exactly", () => {
    const now = Math.floor(Date.now() / 1000);
    // Since isExpired uses >=, mocking Date.now isn't needed if we use a past-enough value
    jest.spyOn(Date, "now").mockReturnValue(now * 1000);
    expect(isExpired(now)).toBe(true);
    jest.restoreAllMocks();
  });
});

// ============================================================================
// createDID
// ============================================================================

describe("createDID", () => {
  const FAKE_HASH = "0x" + "ab".repeat(32);

  beforeEach(() => {
    mockedKeccak256.mockReturnValue(FAKE_HASH as any);
  });

  it("creates a DID with default mainnet network", () => {
    const did = createDID("0xidentifier123");
    expect(did.uri).toBe("did:aethelred:mainnet:0xidentifier123");
    expect(did.identifier).toBe("0xidentifier123");
    expect(did.hash).toBe(FAKE_HASH);
    expect(did.network).toBe("mainnet");
    expect(toBytes).toHaveBeenCalledWith(
      "did:aethelred:mainnet:0xidentifier123",
    );
    expect(keccak256).toHaveBeenCalled();
  });

  it("creates a DID with testnet network", () => {
    const did = createDID("myid", "testnet");
    expect(did.uri).toBe("did:aethelred:testnet:myid");
    expect(did.network).toBe("testnet");
  });

  it("creates a DID with devnet network", () => {
    const did = createDID("devid", "devnet");
    expect(did.uri).toBe("did:aethelred:devnet:devid");
    expect(did.network).toBe("devnet");
  });
});

// ============================================================================
// parseDID
// ============================================================================

describe("parseDID", () => {
  const FAKE_HASH = "0x" + "ab".repeat(32);

  beforeEach(() => {
    mockedKeccak256.mockReturnValue(FAKE_HASH as any);
  });

  it("parses a valid mainnet DID URI", () => {
    const did = parseDID("did:aethelred:mainnet:0xabc123");
    expect(did).not.toBeNull();
    expect(did!.uri).toBe("did:aethelred:mainnet:0xabc123");
    expect(did!.identifier).toBe("0xabc123");
    expect(did!.network).toBe("mainnet");
    expect(did!.hash).toBe(FAKE_HASH);
  });

  it("parses a valid testnet DID URI", () => {
    const did = parseDID("did:aethelred:testnet:someid");
    expect(did).not.toBeNull();
    expect(did!.network).toBe("testnet");
  });

  it("parses a valid devnet DID URI", () => {
    const did = parseDID("did:aethelred:devnet:someid");
    expect(did).not.toBeNull();
    expect(did!.network).toBe("devnet");
  });

  it("returns null for wrong number of parts (too few)", () => {
    expect(parseDID("did:aethelred:mainnet")).toBeNull();
  });

  it("returns null for wrong number of parts (too many)", () => {
    expect(parseDID("did:aethelred:mainnet:id:extra")).toBeNull();
  });

  it('returns null when first part is not "did"', () => {
    expect(parseDID("xxx:aethelred:mainnet:id")).toBeNull();
  });

  it('returns null when second part is not "aethelred"', () => {
    expect(parseDID("did:other:mainnet:id")).toBeNull();
  });

  it("returns null for unsupported network", () => {
    expect(parseDID("did:aethelred:localhost:id")).toBeNull();
  });

  it("returns null when identifier is empty", () => {
    expect(parseDID("did:aethelred:mainnet:")).toBeNull();
  });
});

// ============================================================================
// hashDID
// ============================================================================

describe("hashDID", () => {
  it("returns keccak256 of the URI bytes", () => {
    const FAKE_HASH = "0x" + "cd".repeat(32);
    mockedKeccak256.mockReturnValue(FAKE_HASH as any);

    const result = hashDID("did:aethelred:mainnet:0xabc");
    expect(toBytes).toHaveBeenCalledWith("did:aethelred:mainnet:0xabc");
    expect(keccak256).toHaveBeenCalled();
    expect(result).toBe(FAKE_HASH);
  });
});

// ============================================================================
// formatNumber
// ============================================================================

describe("formatNumber", () => {
  it("formats billions with 2 decimal places", () => {
    expect(formatNumber(1_500_000_000)).toBe("1.50B");
  });

  it("formats exactly 1 billion", () => {
    expect(formatNumber(1_000_000_000)).toBe("1.00B");
  });

  it("formats millions with 1 decimal place by default", () => {
    expect(formatNumber(2_500_000)).toBe("2.5M");
  });

  it("formats millions with custom decimals", () => {
    expect(formatNumber(2_500_000, 2)).toBe("2.50M");
  });

  it("formats thousands with 1 decimal place by default", () => {
    expect(formatNumber(1_500)).toBe("1.5K");
  });

  it("formats thousands with custom decimals", () => {
    expect(formatNumber(1_500, 3)).toBe("1.500K");
  });

  it("formats numbers below 1000 with specified decimals", () => {
    expect(formatNumber(42)).toBe("42");
  });

  it("formats numbers below 1000 with decimal places", () => {
    expect(formatNumber(42.567, 2)).toBe("42.57");
  });

  it("formats zero", () => {
    expect(formatNumber(0)).toBe("0");
  });

  it("formats exactly 1000", () => {
    expect(formatNumber(1000)).toBe("1.0K");
  });

  it("formats exactly 1_000_000", () => {
    expect(formatNumber(1_000_000)).toBe("1.0M");
  });
});

// ============================================================================
// formatPercent
// ============================================================================

describe("formatPercent", () => {
  it("formats with default 1 decimal", () => {
    expect(formatPercent(95.5)).toBe("95.5%");
  });

  it("formats with 0 decimals", () => {
    expect(formatPercent(95.5, 0)).toBe("96%");
  });

  it("formats with 3 decimals", () => {
    expect(formatPercent(12.3456, 3)).toBe("12.346%");
  });

  it("formats zero", () => {
    expect(formatPercent(0)).toBe("0.0%");
  });

  it("formats 100", () => {
    expect(formatPercent(100)).toBe("100.0%");
  });
});

// ============================================================================
// copyToClipboard
// ============================================================================

describe("copyToClipboard", () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it("returns true when clipboard.writeText succeeds", async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {
        clipboard: {
          writeText: jest.fn().mockResolvedValue(undefined),
        },
      },
      writable: true,
      configurable: true,
    });

    const result = await copyToClipboard("hello");
    expect(result).toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("hello");
  });

  it("returns false when clipboard.writeText throws", async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {
        clipboard: {
          writeText: jest.fn().mockRejectedValue(new Error("denied")),
        },
      },
      writable: true,
      configurable: true,
    });

    const result = await copyToClipboard("hello");
    expect(result).toBe(false);
  });

  it("returns false when clipboard API is unavailable", async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: undefined },
      writable: true,
      configurable: true,
    });

    const result = await copyToClipboard("hello");
    expect(result).toBe(false);
  });
});

// ============================================================================
// stringToBytes32
// ============================================================================

describe("stringToBytes32", () => {
  it("returns keccak256 hash of the input string", () => {
    const FAKE_HASH = "0x" + "ff".repeat(32);
    mockedKeccak256.mockReturnValue(FAKE_HASH as any);

    const result = stringToBytes32("hello");
    expect(toBytes).toHaveBeenCalledWith("hello");
    expect(keccak256).toHaveBeenCalled();
    expect(result).toBe(FAKE_HASH);
  });
});

// ============================================================================
// numberToHex
// ============================================================================

describe("numberToHex", () => {
  it("converts a number to hex via toHex(BigInt(n))", () => {
    mockedToHex.mockReturnValue("0xff");
    const result = numberToHex(255);
    expect(toHex).toHaveBeenCalledWith(BigInt(255));
    expect(result).toBe("0xff");
  });

  it("converts a bigint to hex", () => {
    mockedToHex.mockReturnValue("0x1");
    const result = numberToHex(BigInt(1));
    expect(toHex).toHaveBeenCalledWith(BigInt(1));
    expect(result).toBe("0x1");
  });

  it("converts zero", () => {
    mockedToHex.mockReturnValue("0x0");
    const result = numberToHex(0);
    expect(toHex).toHaveBeenCalledWith(BigInt(0));
    expect(result).toBe("0x0");
  });
});

// ============================================================================
// sleep
// ============================================================================

describe("sleep", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("resolves after the specified delay", async () => {
    const promise = sleep(1000);
    jest.advanceTimersByTime(1000);
    await expect(promise).resolves.toBeUndefined();
  });

  it("does not resolve before the delay", () => {
    let resolved = false;
    sleep(500).then(() => {
      resolved = true;
    });
    jest.advanceTimersByTime(499);
    expect(resolved).toBe(false);
  });

  it("resolves with 0ms delay", async () => {
    const promise = sleep(0);
    jest.advanceTimersByTime(0);
    await expect(promise).resolves.toBeUndefined();
  });
});

// ============================================================================
// withRetry
// ============================================================================

describe("withRetry", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns the result on first attempt success", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    const promise = withRetry(fn);
    const result = await promise;
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds on second attempt", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("ok");

    const promise = withRetry(fn, 3, 100);

    // First attempt fails, then sleeps for 100ms (baseDelay * 2^0)
    await jest.advanceTimersByTimeAsync(100);
    const result = await promise;
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries up to maxRetries and then throws the last error", async () => {
    jest.useRealTimers();
    const error = new Error("persistent failure");
    const fn = jest.fn().mockRejectedValue(error);

    await expect(withRetry(fn, 2, 10)).rejects.toThrow("persistent failure");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    jest.useFakeTimers();
  });

  it("uses exponential backoff for delays", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("1"))
      .mockRejectedValueOnce(new Error("2"))
      .mockRejectedValueOnce(new Error("3"))
      .mockResolvedValueOnce("done");

    const promise = withRetry(fn, 3, 100);

    // attempt 0 fails -> delay = 100 * 2^0 = 100ms
    await jest.advanceTimersByTimeAsync(100);
    // attempt 1 fails -> delay = 100 * 2^1 = 200ms
    await jest.advanceTimersByTimeAsync(200);
    // attempt 2 fails -> delay = 100 * 2^2 = 400ms
    await jest.advanceTimersByTimeAsync(400);
    // attempt 3 succeeds

    const result = await promise;
    expect(result).toBe("done");
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("works with default parameters (maxRetries=3, baseDelayMs=1000)", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("ok");

    const promise = withRetry(fn);

    // First retry delay: 1000 * 2^0 = 1000ms
    await jest.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result).toBe("ok");
  });

  it("with maxRetries=0, does not retry", async () => {
    const error = new Error("no retry");
    const fn = jest.fn().mockRejectedValue(error);

    await expect(withRetry(fn, 0, 100)).rejects.toThrow("no retry");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// withTimeout
// ============================================================================

describe("withTimeout", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("resolves when the promise completes before timeout", async () => {
    const promise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("done"), 100);
    });

    const wrapped = withTimeout(promise, 500);
    jest.advanceTimersByTime(100);
    await expect(wrapped).resolves.toBe("done");
  });

  it("rejects with timeout error when promise takes too long", async () => {
    const promise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("too late"), 5000);
    });

    const wrapped = withTimeout(promise, 100);
    jest.advanceTimersByTime(100);
    await expect(wrapped).rejects.toThrow("Operation timed out");
  });

  it("uses a custom timeout message", async () => {
    const promise = new Promise<string>(() => {
      // never resolves
    });

    const wrapped = withTimeout(promise, 50, "Custom timeout message");
    jest.advanceTimersByTime(50);
    await expect(wrapped).rejects.toThrow("Custom timeout message");
  });

  it("rejects with the original error when promise rejects before timeout", async () => {
    const promise = new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error("original error")), 50);
    });

    const wrapped = withTimeout(promise, 500);
    jest.advanceTimersByTime(50);
    await expect(wrapped).rejects.toThrow("original error");
  });

  it("clears the timeout timer on successful resolution", async () => {
    const clearTimeoutSpy = jest.spyOn(globalThis, "clearTimeout");
    const promise = Promise.resolve("fast");

    const wrapped = withTimeout(promise, 1000);
    const result = await wrapped;
    expect(result).toBe("fast");
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it("clears the timeout timer on promise rejection", async () => {
    const clearTimeoutSpy = jest.spyOn(globalThis, "clearTimeout");
    const promise = Promise.reject(new Error("boom"));

    const wrapped = withTimeout(promise, 1000);
    await expect(wrapped).rejects.toThrow("boom");
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
