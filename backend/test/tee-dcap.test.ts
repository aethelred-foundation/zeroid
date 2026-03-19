/**
 * DCAP Attestation Regression Tests
 *
 * Exercises the real TEEAttestationService methods (not mocks) with
 * synthetic SGX quote vectors. Covers:
 *   - Quote binary parsing (header + report body extraction)
 *   - Structural validation (version, key type, vendor ID)
 *   - User data binding (SHA-256 of public key in reportData)
 *   - DCAP certification chain verification (real EC P-256 key pairs)
 *   - TCB evaluation (16-component SVN matching + pceSvn)
 *   - DER/ASN.1 helpers (length parsing, OID conversion, time parsing)
 *   - CRL parsing (PEM and hex-encoded DER)
 *   - QE report identity verification
 *   - Error paths (truncated quotes, wrong versions, bad bindings)
 */
import * as crypto from "crypto";

// Import the class directly — we instantiate it ourselves to avoid
// the singleton's logger/redis dependency during construction.
// We access private methods via (service as any).
import {
  TEEAttestationService,
  AttestationError,
  TCBStatus,
} from "../src/services/tee";

// ---------------------------------------------------------------------------
// Suppress logger and stub redis/prisma before the service module loads
// ---------------------------------------------------------------------------
jest.mock("../src/index", () => {
  const { Registry } = require("prom-client");
  return {
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
    redis: {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue("OK"),
      del: jest.fn().mockResolvedValue(1),
    },
    prisma: {
      identity: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    },
    metricsRegistry: new Registry(),
  };
});

// ---------------------------------------------------------------------------
// Constants matching tee.ts binary layout
// ---------------------------------------------------------------------------
const QUOTE_HEADER_SIZE = 48;
const REPORT_BODY_SIZE = 384;
const QUOTE_BODY_SIZE = QUOTE_HEADER_SIZE + REPORT_BODY_SIZE; // 432
const ISV_SIGNATURE_SIZE = 64;
const ATTEST_KEY_SIZE = 64;
const QE_REPORT_BODY_SIZE = 384;
const QE_SIGNATURE_SIZE = 64;
const INTEL_QE_VENDOR = "939a7233f79c4ca9940a0db3957f0607";

// ---------------------------------------------------------------------------
// Synthetic quote builder
// ---------------------------------------------------------------------------
interface QuoteBuilderOptions {
  version?: number;
  attestKeyType?: number;
  teeType?: number;
  qeSvn?: number;
  pceSvn?: number;
  qeVendorId?: string; // 16 bytes hex
  cpuSvn?: string; // 16 bytes hex (32 chars)
  mrenclave?: string; // 32 bytes hex
  mrsigner?: string; // 32 bytes hex
  isvProdId?: number;
  isvSvn?: number;
  reportData?: string; // 64 bytes hex
  // Certification chain data
  isvSignature?: Buffer; // 64 bytes r||s
  attestKeyX?: Buffer; // 32 bytes
  attestKeyY?: Buffer; // 32 bytes
  qeReportBody?: Buffer; // 384 bytes
  qeSignature?: Buffer; // 64 bytes r||s
  qeAuthData?: Buffer;
  certDataType?: number;
  certChainPem?: string;
}

function buildSyntheticQuote(opts: QuoteBuilderOptions = {}): Buffer {
  const header = Buffer.alloc(QUOTE_HEADER_SIZE);
  header.writeUInt16LE(opts.version ?? 3, 0);
  header.writeUInt16LE(opts.attestKeyType ?? 2, 2);
  header.writeUInt32LE(opts.teeType ?? 0, 4);
  header.writeUInt16LE(opts.qeSvn ?? 6, 8);
  header.writeUInt16LE(opts.pceSvn ?? 10, 10);
  Buffer.from(opts.qeVendorId ?? INTEL_QE_VENDOR, "hex").copy(header, 12);

  const reportBody = Buffer.alloc(REPORT_BODY_SIZE);
  const cpuSvn = opts.cpuSvn ?? "0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a";
  Buffer.from(cpuSvn, "hex").copy(reportBody, 0);
  const mrenclave = opts.mrenclave ?? crypto.randomBytes(32).toString("hex");
  Buffer.from(mrenclave, "hex").copy(reportBody, 64);
  const mrsigner = opts.mrsigner ?? crypto.randomBytes(32).toString("hex");
  Buffer.from(mrsigner, "hex").copy(reportBody, 128);
  reportBody.writeUInt16LE(opts.isvProdId ?? 1, 256);
  reportBody.writeUInt16LE(opts.isvSvn ?? 2, 258);
  if (opts.reportData) {
    Buffer.from(opts.reportData, "hex").copy(reportBody, 320);
  }

  const quoteBody = Buffer.concat([header, reportBody]);

  // If no cert chain data is requested, return just the quote body + minimal padding
  if (!opts.certChainPem) {
    // Pad to minimum parseable length (436 bytes per parseQuote requirement)
    const padding = Buffer.alloc(Math.max(0, 436 - quoteBody.length));
    return Buffer.concat([quoteBody, padding]);
  }

  // Build full quote with certification data
  const isvSig = opts.isvSignature ?? Buffer.alloc(ISV_SIGNATURE_SIZE);
  const attestKeyXBuf = opts.attestKeyX ?? Buffer.alloc(32);
  const attestKeyYBuf = opts.attestKeyY ?? Buffer.alloc(32);
  const qeReport = opts.qeReportBody ?? Buffer.alloc(QE_REPORT_BODY_SIZE);
  const qeSig = opts.qeSignature ?? Buffer.alloc(QE_SIGNATURE_SIZE);
  const qeAuthData = opts.qeAuthData ?? Buffer.alloc(0);
  const certDataType = opts.certDataType ?? 5;
  const certChainBuf = Buffer.from(opts.certChainPem, "utf8");

  const qeAuthLenBuf = Buffer.alloc(2);
  qeAuthLenBuf.writeUInt16LE(qeAuthData.length, 0);

  const certDataHeader = Buffer.alloc(6);
  certDataHeader.writeUInt16LE(certDataType, 0);
  certDataHeader.writeUInt32LE(certChainBuf.length, 2);

  return Buffer.concat([
    quoteBody,
    isvSig,
    attestKeyXBuf,
    attestKeyYBuf,
    qeReport,
    qeSig,
    qeAuthLenBuf,
    qeAuthData,
    certDataHeader,
    certChainBuf,
  ]);
}

// ---------------------------------------------------------------------------
// Helper: create a service instance for testing
// ---------------------------------------------------------------------------
function createService(): TEEAttestationService {
  return new TEEAttestationService();
}

// ---------------------------------------------------------------------------
// Helper: assert an AttestationError with a specific code is thrown
// ---------------------------------------------------------------------------
function expectAttestationError(fn: () => void, code: string): void {
  try {
    fn();
    throw new Error(
      `Expected AttestationError with code ${code} but no error was thrown`,
    );
  } catch (err) {
    if (!(err instanceof AttestationError)) {
      throw new Error(
        `Expected AttestationError but got ${(err as Error).constructor.name}: ${(err as Error).message}`,
      );
    }
    expect(err.code).toBe(code);
  }
}

async function expectAttestationErrorAsync(
  fn: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await fn();
    throw new Error(
      `Expected AttestationError with code ${code} but no error was thrown`,
    );
  } catch (err) {
    if (!(err instanceof AttestationError)) {
      throw new Error(
        `Expected AttestationError but got ${(err as Error).constructor.name}: ${(err as Error).message}`,
      );
    }
    expect(err.code).toBe(code);
  }
}

// ===========================================================================
// Test suites
// ===========================================================================

describe("TEEAttestationService — DCAP Regression Tests", () => {
  let service: TEEAttestationService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let svc: any; // For accessing private methods

  beforeAll(() => {
    service = createService();
    svc = service as any;
  });

  // =========================================================================
  // 1. Quote Parsing
  // =========================================================================
  describe("parseQuote", () => {
    it("parses a well-formed quote header correctly", () => {
      const mrenclave = "a".repeat(64);
      const mrsigner = "b".repeat(64);
      const cpuSvn = "0102030405060708090a0b0c0d0e0f10";
      const reportData = "ff".repeat(64);

      const quote = buildSyntheticQuote({
        version: 3,
        attestKeyType: 2,
        teeType: 0,
        qeSvn: 5,
        pceSvn: 11,
        qeVendorId: INTEL_QE_VENDOR,
        cpuSvn,
        mrenclave,
        mrsigner,
        isvProdId: 42,
        isvSvn: 7,
        reportData,
      });

      const { header, reportBody } = svc.parseQuote(quote);

      expect(header.version).toBe(3);
      expect(header.attestKeyType).toBe(2);
      expect(header.teeType).toBe(0);
      expect(header.qeSvn).toBe(5);
      expect(header.pceSvn).toBe(11);
      expect(header.qeVendorId).toBe(INTEL_QE_VENDOR);

      expect(reportBody.cpuSvn).toBe(cpuSvn);
      expect(reportBody.mrenclave).toBe(mrenclave);
      expect(reportBody.mrsigner).toBe(mrsigner);
      expect(reportBody.isvProdId).toBe(42);
      expect(reportBody.isvSvn).toBe(7);
      expect(reportBody.reportData).toBe(reportData);
    });

    it("parses version 4 quote headers", () => {
      const quote = buildSyntheticQuote({ version: 4 });
      const { header } = svc.parseQuote(quote);
      expect(header.version).toBe(4);
    });

    it("rejects quotes shorter than 436 bytes", () => {
      const shortQuote = Buffer.alloc(435);
      expect(() => svc.parseQuote(shortQuote)).toThrow(AttestationError);
      expect(() => svc.parseQuote(shortQuote)).toThrow("Quote too short");
    });

    it("correctly reads isvProdId and isvSvn at exact offsets", () => {
      // isvProdId at offset 48+256=304, isvSvn at 48+258=306
      const quote = buildSyntheticQuote({ isvProdId: 0xbeef, isvSvn: 0x1234 });
      const { reportBody } = svc.parseQuote(quote);
      expect(reportBody.isvProdId).toBe(0xbeef);
      expect(reportBody.isvSvn).toBe(0x1234);
    });

    it("handles zero-valued fields without error", () => {
      const quote = buildSyntheticQuote({
        version: 3,
        attestKeyType: 2,
        qeSvn: 0,
        pceSvn: 0,
        isvProdId: 0,
        isvSvn: 0,
        cpuSvn: "00".repeat(16),
      });
      const { header, reportBody } = svc.parseQuote(quote);
      expect(header.qeSvn).toBe(0);
      expect(header.pceSvn).toBe(0);
      expect(reportBody.isvProdId).toBe(0);
      expect(reportBody.isvSvn).toBe(0);
    });
  });

  // =========================================================================
  // 2. Structural Validation
  // =========================================================================
  describe("validateQuoteStructure", () => {
    it("accepts version 3 with ECDSA-256 and Intel QE vendor", () => {
      const header = {
        version: 3,
        attestKeyType: 2,
        teeType: 0,
        qeSvn: 5,
        pceSvn: 10,
        qeVendorId: INTEL_QE_VENDOR,
      };
      expect(() => svc.validateQuoteStructure(header, {})).not.toThrow();
    });

    it("accepts version 4", () => {
      const header = {
        version: 4,
        attestKeyType: 2,
        teeType: 0,
        qeSvn: 5,
        pceSvn: 10,
        qeVendorId: INTEL_QE_VENDOR,
      };
      expect(() => svc.validateQuoteStructure(header, {})).not.toThrow();
    });

    it("rejects version 2 (unsupported)", () => {
      const header = {
        version: 2,
        attestKeyType: 2,
        teeType: 0,
        qeSvn: 5,
        pceSvn: 10,
        qeVendorId: INTEL_QE_VENDOR,
      };
      expectAttestationError(
        () => svc.validateQuoteStructure(header, {}),
        "TEE_UNSUPPORTED_VERSION",
      );
    });

    it("rejects version 5 (unsupported)", () => {
      const header = {
        version: 5,
        attestKeyType: 2,
        teeType: 0,
        qeSvn: 5,
        pceSvn: 10,
        qeVendorId: INTEL_QE_VENDOR,
      };
      expectAttestationError(
        () => svc.validateQuoteStructure(header, {}),
        "TEE_UNSUPPORTED_VERSION",
      );
    });

    it("rejects attestKeyType != 2 (non-ECDSA)", () => {
      const header = {
        version: 3,
        attestKeyType: 3,
        teeType: 0,
        qeSvn: 5,
        pceSvn: 10,
        qeVendorId: INTEL_QE_VENDOR,
      };
      expectAttestationError(
        () => svc.validateQuoteStructure(header, {}),
        "TEE_UNSUPPORTED_KEY_TYPE",
      );
    });

    it("rejects unknown QE vendor ID", () => {
      const header = {
        version: 3,
        attestKeyType: 2,
        teeType: 0,
        qeSvn: 5,
        pceSvn: 10,
        qeVendorId: "deadbeef".repeat(4),
      };
      expectAttestationError(
        () => svc.validateQuoteStructure(header, {}),
        "TEE_UNKNOWN_QE_VENDOR",
      );
    });
  });

  // =========================================================================
  // 3. User Data Binding
  // =========================================================================
  describe("verifyUserDataBinding", () => {
    it("accepts when reportData contains correct SHA-256 hash of public key", () => {
      const keyBytes = crypto.randomBytes(65); // simulated compressed EC key
      const keyBase64 = keyBytes.toString("base64");
      const expectedHash = crypto
        .createHash("sha256")
        .update(keyBytes)
        .digest("hex");
      // reportData is 64 bytes hex = 128 chars; first 64 chars = first 32 bytes hash
      const reportData = expectedHash.slice(0, 64) + "00".repeat(32);

      const reportBody = { reportData };
      expect(() =>
        svc.verifyUserDataBinding(reportBody, keyBase64),
      ).not.toThrow();
    });

    it("rejects when reportData hash does not match public key", () => {
      const keyBase64 = crypto.randomBytes(65).toString("base64");
      const reportData = "ff".repeat(64);

      const reportBody = { reportData };
      expectAttestationError(
        () => svc.verifyUserDataBinding(reportBody, keyBase64),
        "TEE_USER_DATA_MISMATCH",
      );
    });

    it("rejects empty public key (hash will not match random reportData)", () => {
      const reportBody = { reportData: "ab".repeat(64) };
      expectAttestationError(
        () => svc.verifyUserDataBinding(reportBody, ""),
        "TEE_USER_DATA_MISMATCH",
      );
    });
  });

  // =========================================================================
  // 4. DER / ASN.1 Helpers
  // =========================================================================
  describe("DER helpers", () => {
    describe("parseDerLength", () => {
      it("parses short-form length (< 128)", () => {
        const buf = Buffer.from([0x30, 0x45]); // SEQUENCE, length 69
        const result = svc.parseDerLength(buf, 1);
        expect(result).toEqual({ contentStart: 2, length: 0x45 });
      });

      it("parses long-form 1-byte length", () => {
        const buf = Buffer.from([0x30, 0x81, 0x80]); // length 128
        const result = svc.parseDerLength(buf, 1);
        expect(result).toEqual({ contentStart: 3, length: 128 });
      });

      it("parses long-form 2-byte length", () => {
        const buf = Buffer.from([0x30, 0x82, 0x01, 0x00]); // length 256
        const result = svc.parseDerLength(buf, 1);
        expect(result).toEqual({ contentStart: 4, length: 256 });
      });

      it("returns null for out-of-bounds offset", () => {
        const buf = Buffer.from([0x30]);
        expect(svc.parseDerLength(buf, 5)).toBeNull();
      });
    });

    describe("derOidToString", () => {
      it("converts ecdsa-with-SHA256 OID bytes to dotted-decimal", () => {
        // OID 1.2.840.10045.4.3.2
        const oidBytes = Buffer.from("2a8648ce3d040302", "hex");
        expect(svc.derOidToString(oidBytes)).toBe("1.2.840.10045.4.3.2");
      });

      it("converts sha256WithRSAEncryption OID", () => {
        // OID 1.2.840.113549.1.1.11
        const oidBytes = Buffer.from("2a864886f70d01010b", "hex");
        expect(svc.derOidToString(oidBytes)).toBe("1.2.840.113549.1.1.11");
      });

      it("returns empty string for empty buffer", () => {
        expect(svc.derOidToString(Buffer.alloc(0))).toBe("");
      });
    });

    describe("oidToHashAlgorithm", () => {
      it("maps ecdsa-with-SHA256 to SHA256", () => {
        expect(svc.oidToHashAlgorithm("1.2.840.10045.4.3.2")).toBe("SHA256");
      });

      it("maps ecdsa-with-SHA384 to SHA384", () => {
        expect(svc.oidToHashAlgorithm("1.2.840.10045.4.3.3")).toBe("SHA384");
      });

      it("maps sha256WithRSAEncryption to SHA256", () => {
        expect(svc.oidToHashAlgorithm("1.2.840.113549.1.1.11")).toBe("SHA256");
      });

      it("returns null for unknown OID", () => {
        expect(svc.oidToHashAlgorithm("1.2.3.4.5")).toBeNull();
      });
    });

    describe("parseAsn1Time", () => {
      it("parses UTCTime (tag 0x17)", () => {
        // 230615120000Z = 2023-06-15T12:00:00Z
        const timeStr = "230615120000Z";
        const buf = Buffer.alloc(2 + timeStr.length);
        buf[0] = 0x17; // UTCTime tag
        buf[1] = timeStr.length;
        Buffer.from(timeStr, "ascii").copy(buf, 2);

        const result = svc.parseAsn1Time(buf, 0);
        expect(result).not.toBeNull();
        expect(result.time).toBe(new Date("2023-06-15T12:00:00Z").getTime());
        expect(result.nextOffset).toBe(2 + timeStr.length);
      });

      it("parses GeneralizedTime (tag 0x18)", () => {
        // 20231215143000Z
        const timeStr = "20231215143000Z";
        const buf = Buffer.alloc(2 + timeStr.length);
        buf[0] = 0x18; // GeneralizedTime tag
        buf[1] = timeStr.length;
        Buffer.from(timeStr, "ascii").copy(buf, 2);

        const result = svc.parseAsn1Time(buf, 0);
        expect(result).not.toBeNull();
        expect(result.time).toBe(new Date("2023-12-15T14:30:00Z").getTime());
      });

      it("handles year >= 50 as 1900s in UTCTime", () => {
        // 990101000000Z = 1999-01-01T00:00:00Z
        const timeStr = "990101000000Z";
        const buf = Buffer.alloc(2 + timeStr.length);
        buf[0] = 0x17;
        buf[1] = timeStr.length;
        Buffer.from(timeStr, "ascii").copy(buf, 2);

        const result = svc.parseAsn1Time(buf, 0);
        expect(result).not.toBeNull();
        expect(result.time).toBe(new Date("1999-01-01T00:00:00Z").getTime());
      });

      it("returns null for non-time tag", () => {
        const buf = Buffer.from([0x30, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00]);
        expect(svc.parseAsn1Time(buf, 0)).toBeNull();
      });
    });
  });

  // =========================================================================
  // 5. buildDERSignature
  // =========================================================================
  describe("buildDERSignature", () => {
    it("produces valid DER for a simple r||s", () => {
      const r = Buffer.alloc(32, 0x01);
      const s = Buffer.alloc(32, 0x02);
      const der = svc.buildDERSignature(r, s);

      // Should start with SEQUENCE tag
      expect(der[0]).toBe(0x30);
      // Should contain two INTEGER elements
      const firstIntTag = der[2]; // after SEQUENCE tag + length
      expect(firstIntTag).toBe(0x02);
    });

    it("adds leading zero byte when high bit is set", () => {
      const r = Buffer.alloc(32);
      r[0] = 0x80; // High bit set
      const s = Buffer.alloc(32, 0x01);
      const der = svc.buildDERSignature(r, s);

      // r INTEGER should have a leading 0x00
      const rLen = der[3]; // tag(0x02) + len byte + first byte
      const rFirstByte = der[4];
      expect(rFirstByte).toBe(0x00);
      expect(rLen).toBe(33); // 32 bytes + 1 leading zero
    });

    it("strips leading zeros from r", () => {
      const r = Buffer.alloc(32, 0x00);
      r[31] = 0x42; // Only last byte non-zero
      const s = Buffer.alloc(32, 0x01);
      const der = svc.buildDERSignature(r, s);

      // r should be trimmed to just [0x42]
      const rLen = der[3];
      expect(rLen).toBe(1);
      expect(der[4]).toBe(0x42);
    });
  });

  // =========================================================================
  // 6. buildECPublicKeyDer
  // =========================================================================
  describe("buildECPublicKeyDer", () => {
    it("produces a valid SPKI structure that Node can import", () => {
      // Generate a real P-256 key pair, extract raw x/y
      const { publicKey } = crypto.generateKeyPairSync("ec", {
        namedCurve: "P-256",
      });
      const jwk = publicKey.export({ format: "jwk" }) as {
        x: string;
        y: string;
      };
      const x = Buffer.from(jwk.x, "base64url");
      const y = Buffer.from(jwk.y, "base64url");

      const spkiDer = svc.buildECPublicKeyDer(x, y);

      // Should be importable as a public key
      const imported = crypto.createPublicKey({
        key: spkiDer,
        format: "der",
        type: "spki",
      });
      expect(imported.type).toBe("public");
      expect(imported.asymmetricKeyType).toBe("ec");
    });

    it("produces a key that verifies a signature from the matching private key", () => {
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
        namedCurve: "P-256",
      });
      const jwk = publicKey.export({ format: "jwk" }) as {
        x: string;
        y: string;
      };
      const x = Buffer.from(jwk.x, "base64url");
      const y = Buffer.from(jwk.y, "base64url");

      const spkiDer = svc.buildECPublicKeyDer(x, y);
      const data = Buffer.from("test data to sign");

      const sig = crypto.sign("SHA256", data, privateKey);
      const valid = crypto.verify(
        "SHA256",
        data,
        { key: spkiDer, format: "der", type: "spki" },
        sig,
      );
      expect(valid).toBe(true);
    });
  });

  // =========================================================================
  // 7. PEM chain parsing
  // =========================================================================
  describe("parsePemChain", () => {
    it("splits concatenated PEM certificates", () => {
      const chain = `-----BEGIN CERTIFICATE-----
MIIB1z...
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIC2z...
-----END CERTIFICATE-----`;
      const certs = svc.parsePemChain(chain);
      expect(certs).toHaveLength(2);
      expect(certs[0]).toContain("MIIB1z");
      expect(certs[1]).toContain("MIIC2z");
    });

    it("returns empty array for non-PEM input", () => {
      expect(svc.parsePemChain("not a pem")).toHaveLength(0);
    });

    it("handles single certificate", () => {
      const single = `-----BEGIN CERTIFICATE-----
MIIBxDCC...
-----END CERTIFICATE-----`;
      expect(svc.parsePemChain(single)).toHaveLength(1);
    });
  });

  // =========================================================================
  // 8. findBuffer
  // =========================================================================
  describe("findBuffer", () => {
    it("finds a sub-buffer at the correct offset", () => {
      const haystack = Buffer.from("00112233445566778899", "hex");
      const needle = Buffer.from("4455", "hex");
      expect(svc.findBuffer(haystack, needle)).toBe(4);
    });

    it("returns -1 when needle is not present", () => {
      const haystack = Buffer.from("0011223344", "hex");
      const needle = Buffer.from("ff", "hex");
      expect(svc.findBuffer(haystack, needle)).toBe(-1);
    });

    it("finds needle at the start", () => {
      const haystack = Buffer.from("aabb", "hex");
      const needle = Buffer.from("aa", "hex");
      expect(svc.findBuffer(haystack, needle)).toBe(0);
    });

    it("finds needle at the end", () => {
      const haystack = Buffer.from("aabb", "hex");
      const needle = Buffer.from("bb", "hex");
      expect(svc.findBuffer(haystack, needle)).toBe(1);
    });
  });

  // =========================================================================
  // 9. CRL Parsing
  // =========================================================================
  describe("parseCrlToDer", () => {
    it("parses hex-encoded DER CRL", () => {
      // Minimal valid-looking DER (SEQUENCE tag)
      const hexCrl = "30820100" + "00".repeat(256);
      const der = svc.parseCrlToDer(hexCrl, "Test CRL");
      expect(der).toBeInstanceOf(Buffer);
      expect(der[0]).toBe(0x30); // SEQUENCE tag
    });

    it("parses PEM-encoded CRL", () => {
      const derBytes = Buffer.alloc(64, 0x30);
      const base64 = derBytes.toString("base64");
      const pem = `-----BEGIN X509 CRL-----\n${base64}\n-----END X509 CRL-----`;
      const result = svc.parseCrlToDer(pem, "PEM CRL");
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBe(64);
    });

    it("rejects empty CRL data", () => {
      expectAttestationError(
        () => svc.parseCrlToDer("", "Empty CRL"),
        "TEE_CRL_MISSING",
      );
    });

    it("rejects too-short hex DER", () => {
      expectAttestationError(
        () => svc.parseCrlToDer("3000", "Short CRL"),
        "TEE_INVALID_CRL",
      );
    });
  });

  // =========================================================================
  // 10. TCB Evaluation
  // =========================================================================
  describe("evaluateTCBStatus", () => {
    const makeTcbCollateral = (
      levels: Array<{
        sgxComponents: number[];
        pcesvn: number;
        status: string;
      }>,
    ): { tcbInfo: string } => {
      const tcbLevels = levels.map((l) => ({
        tcb: {
          sgxtcbcomponents: l.sgxComponents.map((svn) => ({ svn })),
          pcesvn: l.pcesvn,
        },
        tcbStatus: l.status,
      }));

      return {
        tcbInfo: JSON.stringify({
          tcbInfo: {
            fmspc: "00606a000000",
            tcbLevels,
          },
        }),
      };
    };

    it("returns UpToDate when all 16 SVN components and pceSvn meet the highest level", async () => {
      const collateral = makeTcbCollateral([
        { sgxComponents: Array(16).fill(5), pcesvn: 10, status: "UpToDate" },
        { sgxComponents: Array(16).fill(3), pcesvn: 8, status: "OutOfDate" },
      ]);

      const header = { pceSvn: 10 };
      const reportBody = { cpuSvn: "05".repeat(16) }; // all components = 5

      const status = await svc.evaluateTCBStatus(
        collateral,
        header,
        reportBody,
      );
      expect(status).toBe("UpToDate");
    });

    it("falls through to lower level when one SVN component is insufficient", async () => {
      const collateral = makeTcbCollateral([
        {
          sgxComponents: [10, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
          pcesvn: 10,
          status: "UpToDate",
        },
        {
          sgxComponents: Array(16).fill(3),
          pcesvn: 8,
          status: "SWHardeningNeeded",
        },
      ]);

      const header = { pceSvn: 10 };
      // Component 0 is only 9, but level requires 10
      const reportBody = { cpuSvn: "09" + "05".repeat(15) };

      const status = await svc.evaluateTCBStatus(
        collateral,
        header,
        reportBody,
      );
      expect(status).toBe("SWHardeningNeeded");
    });

    it("falls through when pceSvn is below threshold", async () => {
      const collateral = makeTcbCollateral([
        { sgxComponents: Array(16).fill(5), pcesvn: 10, status: "UpToDate" },
        { sgxComponents: Array(16).fill(3), pcesvn: 5, status: "OutOfDate" },
      ]);

      const header = { pceSvn: 9 }; // Below first level's 10
      const reportBody = { cpuSvn: "05".repeat(16) };

      const status = await svc.evaluateTCBStatus(
        collateral,
        header,
        reportBody,
      );
      expect(status).toBe("OutOfDate");
    });

    it("returns OutOfDate when no levels match", async () => {
      const collateral = makeTcbCollateral([
        { sgxComponents: Array(16).fill(10), pcesvn: 10, status: "UpToDate" },
      ]);

      const header = { pceSvn: 1 };
      const reportBody = { cpuSvn: "01".repeat(16) };

      const status = await svc.evaluateTCBStatus(
        collateral,
        header,
        reportBody,
      );
      expect(status).toBe(TCBStatus.OUT_OF_DATE);
    });

    it("skips TCB levels with != 16 SGX components", async () => {
      const collateral = makeTcbCollateral([
        // Bad level with only 8 components — should be skipped
        { sgxComponents: Array(8).fill(1), pcesvn: 1, status: "UpToDate" },
        // Good level
        {
          sgxComponents: Array(16).fill(1),
          pcesvn: 1,
          status: "SWHardeningNeeded",
        },
      ]);

      const header = { pceSvn: 1 };
      const reportBody = { cpuSvn: "01".repeat(16) };

      const status = await svc.evaluateTCBStatus(
        collateral,
        header,
        reportBody,
      );
      expect(status).toBe("SWHardeningNeeded");
    });

    it("throws on invalid CPU SVN length", async () => {
      const collateral = makeTcbCollateral([
        { sgxComponents: Array(16).fill(1), pcesvn: 1, status: "UpToDate" },
      ]);

      const header = { pceSvn: 1 };
      const reportBody = { cpuSvn: "aabb" }; // Only 4 hex chars, not 32

      await expectAttestationErrorAsync(
        () => svc.evaluateTCBStatus(collateral, header, reportBody),
        "TEE_INVALID_CPU_SVN",
      );
    });

    it("handles exact-match SVN values (boundary condition)", async () => {
      const collateral = makeTcbCollateral([
        {
          sgxComponents: [7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          pcesvn: 5,
          status: "UpToDate",
        },
      ]);

      const header = { pceSvn: 5 };
      // Component 0 exactly matches (7 >= 7)
      const reportBody = { cpuSvn: "07" + "00".repeat(15) };

      const status = await svc.evaluateTCBStatus(
        collateral,
        header,
        reportBody,
      );
      expect(status).toBe("UpToDate");
    });

    it("correctly evaluates all 16 individual component positions", async () => {
      // Create a level where component[15] requires SVN=0xFF
      const components = Array(16).fill(0);
      components[15] = 0xff;

      const collateral = makeTcbCollateral([
        { sgxComponents: components, pcesvn: 0, status: "UpToDate" },
      ]);

      const header = { pceSvn: 0 };

      // All zeros except component[15] = 0xff → should match
      const matchBody = { cpuSvn: "00".repeat(15) + "ff" };
      expect(await svc.evaluateTCBStatus(collateral, header, matchBody)).toBe(
        "UpToDate",
      );

      // Component[15] = 0xfe → should NOT match (254 < 255)
      const failBody = { cpuSvn: "00".repeat(15) + "fe" };
      expect(await svc.evaluateTCBStatus(collateral, header, failBody)).toBe(
        TCBStatus.OUT_OF_DATE,
      );
    });
  });

  // =========================================================================
  // 11. QE Report Identity Verification
  // =========================================================================
  describe("verifyQEReportIdentity", () => {
    const makeQEIdentityCollateral = (opts: {
      mrsigner?: string;
      isvprodid?: number;
      tcbLevels?: Array<{ isvsvn: number; tcbStatus: string }>;
    }) => ({
      qeIdentity: JSON.stringify({
        enclaveIdentity: {
          id: "QE",
          mrsigner: opts.mrsigner ?? "ab".repeat(32),
          isvprodid: opts.isvprodid ?? 1,
          tcbLevels: (
            opts.tcbLevels ?? [{ isvsvn: 2, tcbStatus: "UpToDate" }]
          ).map((l) => ({
            tcb: { isvsvn: l.isvsvn },
            tcbStatus: l.tcbStatus,
          })),
        },
      }),
    });

    it("accepts when all QE report fields match identity", () => {
      const mrsigner = "ab".repeat(32);
      const collateral = makeQEIdentityCollateral({ mrsigner, isvprodid: 1 });
      const certResult = {
        qeReportMrsigner: mrsigner,
        qeReportIsvProdId: 1,
        qeReportIsvSvn: 5, // >= any tcbLevel isvsvn
      };

      expect(() =>
        svc.verifyQEReportIdentity(collateral, certResult),
      ).not.toThrow();
    });

    it("rejects MRSIGNER mismatch", () => {
      const collateral = makeQEIdentityCollateral({
        mrsigner: "ab".repeat(32),
      });
      const certResult = {
        qeReportMrsigner: "cd".repeat(32), // Different
        qeReportIsvProdId: 1,
        qeReportIsvSvn: 5,
      };

      expectAttestationError(
        () => svc.verifyQEReportIdentity(collateral, certResult),
        "TEE_QE_MRSIGNER_MISMATCH",
      );
    });

    it("rejects isvProdId mismatch", () => {
      const mrsigner = "ab".repeat(32);
      const collateral = makeQEIdentityCollateral({ mrsigner, isvprodid: 1 });
      const certResult = {
        qeReportMrsigner: mrsigner,
        qeReportIsvProdId: 99, // Wrong
        qeReportIsvSvn: 5,
      };

      expectAttestationError(
        () => svc.verifyQEReportIdentity(collateral, certResult),
        "TEE_QE_ISVPRODID_MISMATCH",
      );
    });

    it("rejects when QE isvSvn is below all non-revoked TCB levels", () => {
      const mrsigner = "ab".repeat(32);
      const collateral = makeQEIdentityCollateral({
        mrsigner,
        isvprodid: 1,
        tcbLevels: [
          { isvsvn: 10, tcbStatus: "UpToDate" },
          { isvsvn: 5, tcbStatus: "Revoked" }, // Revoked levels don't count
        ],
      });
      const certResult = {
        qeReportMrsigner: mrsigner,
        qeReportIsvProdId: 1,
        qeReportIsvSvn: 3, // Below 10 (the only non-revoked level)
      };

      expectAttestationError(
        () => svc.verifyQEReportIdentity(collateral, certResult),
        "TEE_QE_TCB_LEVEL_INSUFFICIENT",
      );
    });

    it("accepts when isvSvn meets a non-revoked level even if higher levels exist", () => {
      const mrsigner = "ab".repeat(32);
      const collateral = makeQEIdentityCollateral({
        mrsigner,
        isvprodid: 1,
        tcbLevels: [
          { isvsvn: 10, tcbStatus: "UpToDate" },
          { isvsvn: 5, tcbStatus: "SWHardeningNeeded" },
          { isvsvn: 2, tcbStatus: "OutOfDate" },
        ],
      });
      const certResult = {
        qeReportMrsigner: mrsigner,
        qeReportIsvProdId: 1,
        qeReportIsvSvn: 6, // Meets level with isvsvn=5
      };

      expect(() =>
        svc.verifyQEReportIdentity(collateral, certResult),
      ).not.toThrow();
    });
  });

  // =========================================================================
  // 12. DCAP Certification Chain (Cryptographic)
  // =========================================================================
  describe("verifyQuoteCertificationChain", () => {
    it("rejects quote with truncated signature section", () => {
      // Build a quote that is exactly 432 bytes (header + report body) — no sig data
      const quote = Buffer.alloc(QUOTE_BODY_SIZE + 10); // too short for 128 bytes of sigs
      quote.writeUInt16LE(3, 0); // version

      expectAttestationError(
        () => svc.verifyQuoteCertificationChain(quote),
        "TEE_QUOTE_TRUNCATED",
      );
    });

    it("rejects quote truncated after ISV sig + attest key (no QE report)", () => {
      const quote = Buffer.alloc(
        QUOTE_BODY_SIZE + ISV_SIGNATURE_SIZE + ATTEST_KEY_SIZE + 10,
      );
      expectAttestationError(
        () => svc.verifyQuoteCertificationChain(quote),
        "TEE_QUOTE_TRUNCATED",
      );
    });

    it("rejects quote truncated after QE report (no QE signature)", () => {
      const quote = Buffer.alloc(
        QUOTE_BODY_SIZE +
          ISV_SIGNATURE_SIZE +
          ATTEST_KEY_SIZE +
          QE_REPORT_BODY_SIZE +
          10,
      );
      expectAttestationError(
        () => svc.verifyQuoteCertificationChain(quote),
        "TEE_QUOTE_TRUNCATED",
      );
    });

    it("rejects unsupported certification data type", () => {
      // Build a quote long enough with cert data type != 5
      const qeAuthLen = 0;
      const certChain =
        "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n-----BEGIN CERTIFICATE-----\nMIIC\n-----END CERTIFICATE-----";
      const certBuf = Buffer.from(certChain, "utf8");

      const minLen =
        QUOTE_BODY_SIZE +
        ISV_SIGNATURE_SIZE +
        ATTEST_KEY_SIZE +
        QE_REPORT_BODY_SIZE +
        QE_SIGNATURE_SIZE +
        2 +
        qeAuthLen +
        6 +
        certBuf.length;
      const quote = Buffer.alloc(minLen);

      // QE auth data length = 0
      const qeAuthLenOffset =
        QUOTE_BODY_SIZE +
        ISV_SIGNATURE_SIZE +
        ATTEST_KEY_SIZE +
        QE_REPORT_BODY_SIZE +
        QE_SIGNATURE_SIZE;
      quote.writeUInt16LE(0, qeAuthLenOffset);

      // Cert data type = 3 (wrong, should be 5)
      const certDataOffset = qeAuthLenOffset + 2;
      quote.writeUInt16LE(3, certDataOffset);
      quote.writeUInt32LE(certBuf.length, certDataOffset + 2);
      certBuf.copy(quote, certDataOffset + 6);

      expectAttestationError(
        () => svc.verifyQuoteCertificationChain(quote),
        "TEE_UNSUPPORTED_CERT_DATA_TYPE",
      );
    });

    it("rejects cert chain with fewer than 2 certificates", () => {
      const singleCert =
        "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
      const certBuf = Buffer.from(singleCert, "utf8");

      const qeAuthLenOffset =
        QUOTE_BODY_SIZE +
        ISV_SIGNATURE_SIZE +
        ATTEST_KEY_SIZE +
        QE_REPORT_BODY_SIZE +
        QE_SIGNATURE_SIZE;
      const certDataOffset = qeAuthLenOffset + 2;
      const totalLen = certDataOffset + 6 + certBuf.length;
      const quote = Buffer.alloc(totalLen);

      quote.writeUInt16LE(0, qeAuthLenOffset);
      quote.writeUInt16LE(5, certDataOffset);
      quote.writeUInt32LE(certBuf.length, certDataOffset + 2);
      certBuf.copy(quote, certDataOffset + 6);

      expectAttestationError(
        () => svc.verifyQuoteCertificationChain(quote),
        "TEE_PCK_CHAIN_INCOMPLETE",
      );
    });
  });

  // =========================================================================
  // 13. Collateral Freshness
  // =========================================================================
  describe("validateCollateralFreshness", () => {
    it("accepts fresh collateral", () => {
      const now = new Date();
      const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const collateral = {
        tcbInfo: JSON.stringify({
          tcbInfo: {
            issueDate: now.toISOString(),
            nextUpdate: nextWeek.toISOString(),
          },
        }),
      };

      expect(() => svc.validateCollateralFreshness(collateral)).not.toThrow();
    });

    it("rejects stale collateral (older than 30 days)", () => {
      const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      const collateral = {
        tcbInfo: JSON.stringify({
          tcbInfo: {
            issueDate: old.toISOString(),
            nextUpdate: new Date(Date.now() + 86400000).toISOString(),
          },
        }),
      };

      expectAttestationError(
        () => svc.validateCollateralFreshness(collateral),
        "TEE_COLLATERAL_STALE",
      );
    });

    it("rejects expired collateral (nextUpdate in the past)", () => {
      const yesterday = new Date(Date.now() - 86400000);
      const collateral = {
        tcbInfo: JSON.stringify({
          tcbInfo: {
            issueDate: new Date(Date.now() - 2 * 86400000).toISOString(),
            nextUpdate: yesterday.toISOString(),
          },
        }),
      };

      expectAttestationError(
        () => svc.validateCollateralFreshness(collateral),
        "TEE_COLLATERAL_EXPIRED",
      );
    });

    it("rejects future-dated collateral", () => {
      const tomorrow = new Date(Date.now() + 86400000);
      const collateral = {
        tcbInfo: JSON.stringify({
          tcbInfo: {
            issueDate: tomorrow.toISOString(),
            nextUpdate: new Date(Date.now() + 2 * 86400000).toISOString(),
          },
        }),
      };

      expectAttestationError(
        () => svc.validateCollateralFreshness(collateral),
        "TEE_COLLATERAL_FUTURE_DATE",
      );
    });

    it("rejects missing issueDate", () => {
      const collateral = {
        tcbInfo: JSON.stringify({
          tcbInfo: {
            nextUpdate: new Date(Date.now() + 86400000).toISOString(),
          },
        }),
      };

      expectAttestationError(
        () => svc.validateCollateralFreshness(collateral),
        "TEE_COLLATERAL_NO_ISSUE_DATE",
      );
    });

    it("rejects missing nextUpdate", () => {
      const collateral = {
        tcbInfo: JSON.stringify({
          tcbInfo: {
            issueDate: new Date().toISOString(),
          },
        }),
      };

      expectAttestationError(
        () => svc.validateCollateralFreshness(collateral),
        "TEE_COLLATERAL_NO_NEXT_UPDATE",
      );
    });
  });

  // =========================================================================
  // 14. TCB Policy Enforcement
  // =========================================================================
  describe("enforceTCBPolicy", () => {
    it("accepts UpToDate (default allowed status)", () => {
      expect(() => svc.enforceTCBPolicy(TCBStatus.UP_TO_DATE)).not.toThrow();
    });

    it("rejects Revoked status", () => {
      expectAttestationError(
        () => svc.enforceTCBPolicy(TCBStatus.REVOKED),
        "TEE_TCB_STATUS_REJECTED",
      );
    });

    it("rejects OutOfDate status", () => {
      expectAttestationError(
        () => svc.enforceTCBPolicy(TCBStatus.OUT_OF_DATE),
        "TEE_TCB_STATUS_REJECTED",
      );
    });
  });

  // =========================================================================
  // 15. Advisory ID mapping
  // =========================================================================
  describe("getAdvisoryIds", () => {
    it("returns empty for UpToDate", () => {
      expect(svc.getAdvisoryIds(TCBStatus.UP_TO_DATE)).toEqual([]);
    });

    it("returns INTEL-SA-00334 for SWHardeningNeeded", () => {
      expect(svc.getAdvisoryIds(TCBStatus.SW_HARDENING_NEEDED)).toContain(
        "INTEL-SA-00334",
      );
    });

    it("returns multiple advisories for ConfigurationAndSWHardeningNeeded", () => {
      const ids = svc.getAdvisoryIds(
        TCBStatus.CONFIGURATION_AND_SW_HARDENING_NEEDED,
      );
      expect(ids).toContain("INTEL-SA-00219");
      expect(ids).toContain("INTEL-SA-00289");
      expect(ids).toContain("INTEL-SA-00334");
    });

    it("returns INTEL-SA-00477 for OutOfDate", () => {
      expect(svc.getAdvisoryIds(TCBStatus.OUT_OF_DATE)).toContain(
        "INTEL-SA-00477",
      );
    });
  });

  // =========================================================================
  // 16. sha256Hex
  // =========================================================================
  describe("sha256Hex", () => {
    it("produces correct SHA-256 hex digest", () => {
      const data = Buffer.from("hello world");
      const expected = crypto.createHash("sha256").update(data).digest("hex");
      expect(svc.sha256Hex(data)).toBe(expected);
    });

    it("produces a 64-char hex string", () => {
      const result = svc.sha256Hex(Buffer.from("test"));
      expect(result).toHaveLength(64);
      expect(/^[0-9a-f]+$/.test(result)).toBe(true);
    });
  });

  // =========================================================================
  // 17. End-to-end quote parsing + user data binding integration
  // =========================================================================
  describe("quote parsing → user data binding integration", () => {
    it("round-trips: build quote with correct reportData, parse, verify binding", () => {
      const keyBytes = crypto.randomBytes(65);
      const keyBase64 = keyBytes.toString("base64");
      const keyHash = crypto
        .createHash("sha256")
        .update(keyBytes)
        .digest("hex");
      const reportData = keyHash.slice(0, 64) + "00".repeat(32);

      const quote = buildSyntheticQuote({ reportData });
      const { reportBody } = svc.parseQuote(quote);

      expect(() =>
        svc.verifyUserDataBinding(reportBody, keyBase64),
      ).not.toThrow();
    });

    it("detects tampered reportData after quote construction", () => {
      const keyBytes = crypto.randomBytes(65);
      const keyBase64 = keyBytes.toString("base64");
      const reportData = "dead".repeat(32); // wrong hash

      const quote = buildSyntheticQuote({ reportData });
      const { reportBody } = svc.parseQuote(quote);

      expectAttestationError(
        () => svc.verifyUserDataBinding(reportBody, keyBase64),
        "TEE_USER_DATA_MISMATCH",
      );
    });
  });

  // =========================================================================
  // 18. Enclave type assertion
  // =========================================================================
  describe("assertSupportedEnclaveType", () => {
    it("accepts SGX", () => {
      expect(() => svc.assertSupportedEnclaveType("SGX")).not.toThrow();
    });

    it("rejects non-SGX types", () => {
      expectAttestationError(
        () => svc.assertSupportedEnclaveType("TDX"),
        "TEE_UNSUPPORTED_ENCLAVE_TYPE",
      );
      expectAttestationError(
        () => svc.assertSupportedEnclaveType("SEV"),
        "TEE_UNSUPPORTED_ENCLAVE_TYPE",
      );
    });
  });
});
