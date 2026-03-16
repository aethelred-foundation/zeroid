import { logger, redis, prisma, metricsRegistry } from '../index';
import * as crypto from 'crypto';
import { Counter, Histogram } from 'prom-client';

// ---------------------------------------------------------------------------
// Prometheus metrics — TEE attestation observability
// ---------------------------------------------------------------------------
const teeAttestationTotal = new Counter({
  name: 'zeroid_tee_attestation_total',
  help: 'Total TEE attestation attempts',
  labelNames: ['result', 'error_code'] as const,
  registers: [metricsRegistry],
});

const teeAttestationDuration = new Histogram({
  name: 'zeroid_tee_attestation_duration_seconds',
  help: 'TEE attestation verification duration in seconds',
  labelNames: ['result'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [metricsRegistry],
});

const teeTCBStatusTotal = new Counter({
  name: 'zeroid_tee_tcb_status_total',
  help: 'TCB status distribution for successful attestations',
  labelNames: ['tcb_status'] as const,
  registers: [metricsRegistry],
});

const teeFMSPCTotal = new Counter({
  name: 'zeroid_tee_fmspc_total',
  help: 'Attestations by FMSPC (platform identifier)',
  labelNames: ['fmspc'] as const,
  registers: [metricsRegistry],
});

const teeMRSIGNERTotal = new Counter({
  name: 'zeroid_tee_mrsigner_total',
  help: 'Attestations by MRSIGNER (enclave signer)',
  labelNames: ['mrsigner'] as const,
  registers: [metricsRegistry],
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface TEEAttestationRequest {
  identityId: string;
  did: string;
  publicKey: string;
  enclaveType: 'SGX';
  quote: string; // base64-encoded attestation quote
  userData?: string;
}

export interface TEEAttestationResult {
  attestationId: string;
  verified: boolean;
  enclaveType: string;
  mrsigner: string;
  mrenclave: string;
  isvProdId: number;
  isvSvn: number;
  tcbStatus: TCBStatus;
  advisoryIds: string[];
  timestamp: Date;
  expiresAt: Date;
}

export enum TCBStatus {
  UP_TO_DATE = 'UpToDate',
  SW_HARDENING_NEEDED = 'SWHardeningNeeded',
  CONFIGURATION_NEEDED = 'ConfigurationNeeded',
  CONFIGURATION_AND_SW_HARDENING_NEEDED = 'ConfigurationAndSWHardeningNeeded',
  OUT_OF_DATE = 'OutOfDate',
  REVOKED = 'Revoked',
}

interface SGXQuoteHeader {
  version: number;
  attestKeyType: number;
  teeType: number;
  qeSvn: number;
  pceSvn: number;
  qeVendorId: string;
}

interface SGXReportBody {
  cpuSvn: string;
  mrenclave: string;
  mrsigner: string;
  isvProdId: number;
  isvSvn: number;
  reportData: string;
}

interface QuoteCertificationResult {
  fmspc: string;
  qeReportMrenclave: string;
  qeReportMrsigner: string;
  qeReportIsvProdId: number;
  qeReportIsvSvn: number;
}

interface PCCSCollateral {
  pckCrl: string;
  pckCrlIssuerChain: string;
  rootCaCrl: string;
  tcbInfo: string;
  tcbInfoSignature: string;
  tcbSigningCertChain: string;
  qeIdentity: string;
  qeIdentitySignature: string;
  qeIdentitySigningCertChain: string;
}

interface CachedCollateral {
  collateral: PCCSCollateral;
  fmspc: string;
  cachedAt: number;      // epoch ms
  issueDate: number;     // epoch ms from tcbInfo
  nextUpdate: number;    // epoch ms from tcbInfo
  refreshStatus: 'fresh' | 'refreshing' | 'stale';
}

// ---------------------------------------------------------------------------
// Intel SGX PCCS / DCAP configuration
// ---------------------------------------------------------------------------
const INTEL_PCS_BASE_URL = process.env.INTEL_PCS_URL ?? 'https://api.trustedservices.intel.com/sgx/certification/v4';
const TEE_DCAP_BASE_URL = process.env.TEE_DCAP_API_URL ?? INTEL_PCS_BASE_URL;
const INTEL_PCS_API_KEY = process.env.INTEL_PCS_API_KEY ?? '';
const ATTESTATION_VALIDITY_HOURS = parseInt(process.env.TEE_ATTESTATION_VALIDITY_HOURS ?? '24', 10);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Maximum age for collateral before it is considered stale (30 days)
const MAX_COLLATERAL_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Trigger background refresh when collateral has reached 80% of its max age
const COLLATERAL_REFRESH_THRESHOLD = 0.8 * MAX_COLLATERAL_AGE_MS;

// Allowed MRSIGNER values (operator-configured trust anchors)
const TRUSTED_MRSIGNERS = new Set(
  (process.env.TRUSTED_MRSIGNERS ?? '').split(',').filter(Boolean),
);

// Minimum ISV SVN required
const MIN_ISV_SVN = parseInt(process.env.MIN_ISV_SVN ?? '1', 10);
const ALLOWED_TCB_STATUSES = new Set(
  (process.env.TEE_ALLOWED_TCB_STATUSES ?? TCBStatus.UP_TO_DATE)
    .split(',')
    .map((status) => status.trim())
    .filter(Boolean),
);

// ---------------------------------------------------------------------------
// Intel SGX Root CA certificate (well-known trust anchor)
// This is the Intel SGX Root CA used to anchor all DCAP certificate chains.
// Subject: CN=Intel SGX Root CA, O=Intel Corporation, L=Santa Clara, ST=CA, C=US
// ---------------------------------------------------------------------------
const INTEL_SGX_ROOT_CA_PEM = `-----BEGIN CERTIFICATE-----
MIICjzCCAjSgAwIBAgIUImUM1lqdNInzg7SVUr9QGzknBqwwCgYIKoZIzj0EAwIw
aDEaMBgGA1UEAwwRSW50ZWwgU0dYIFJvb3QgQ0ExGjAYBgNVBAoMEUludGVsIENv
cnBvcmF0aW9uMRQwEgYDVQQHDAtTYW50YSBDbGFyYTELMAkGA1UECAwCQ0ExCzAJ
BgNVBAYTAlVTMB4XDTE4MDUyMTEwNDUxMFoXDTQ5MTIzMTIzNTk1OVowaDEaMBgG
A1UEAwwRSW50ZWwgU0dYIFJvb3QgQ0ExGjAYBgNVBAoMEUludGVsIENvcnBvcmF0
aW9uMRQwEgYDVQQHDAtTYW50YSBDbGFyYTELMAkGA1UECAwCQ0ExCzAJBgNVBAYT
AlVTMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEC6nEwMDIYZOj/iPWsCzaEKi7
1OiOSLRFhWGjbnBVJfVnkY4u3IjkDYYL0MxO4mqsyYjlBalTVYxFP2sJBK5zlKOB
uzCBuDAfBgNVHSMEGDAWgBQiZQzWWp00ifODtJVSv1AbOScGrDBSBgNVHR8ESzBJ
MEegRaBDhkFodHRwczovL2NlcnRpZmljYXRlcy50cnVzdGVkc2VydmljZXMuaW50
ZWwuY29tL0ludGVsU0dYUm9vdENBLmRlcjAdBgNVHQ4EFgQUImUM1lqdNInzg7SV
Ur9QGzknBqwwDgYDVR0PAQH/BAQDAgEGMBIGA1UdEwEB/wQIMAYBAf8CAQEwCgYI
KoZIzj0EAwIDSQAwRgIhAOW/5QkR+S9CiSDcNoowLuPRLsWGf/Yi7GSX94BgwTwg
AiEA4J0lrHoMs+Xo5o/sX6O9QWxHRAvZUGOdRQ7cvqRXaqI=
-----END CERTIFICATE-----`;

// ---------------------------------------------------------------------------
// TEE Attestation Service
// ---------------------------------------------------------------------------
export class TEEAttestationService {
  // -------------------------------------------------------------------------
  // Verify an SGX/DCAP attestation quote
  // -------------------------------------------------------------------------
  async verifyAttestation(request: TEEAttestationRequest): Promise<TEEAttestationResult> {
    const attestationId = crypto.randomUUID();
    const startTime = process.hrtime.bigint();
    logger.info('tee_attestation_start', {
      attestationId,
      identityId: request.identityId,
      enclaveType: request.enclaveType,
    });

    try {
      this.assertSupportedEnclaveType(request.enclaveType);
      this.assertCollateralProviderConfigured();

      // 1. Decode and parse the quote
      const quoteBuffer = Buffer.from(request.quote, 'base64');
      const { header, reportBody } = this.parseQuote(quoteBuffer);

      // 2. Verify quote structure
      this.validateQuoteStructure(header, reportBody);

      // 3. Verify user data binding (public key is bound into the enclave report)
      this.verifyUserDataBinding(reportBody, request.publicKey);

      // 4. Verify the full DCAP certification chain embedded in the quote.
      //    This establishes trust from Intel Root CA → PCK cert → QE Report →
      //    attestation key → quote body, in that order. Only after this chain
      //    is verified do we trust the FMSPC or the quote signature.
      const certResult = this.verifyQuoteCertificationChain(quoteBuffer);

      // 5. Fetch PCCS collateral using the now-verified FMSPC
      const collateral = await this.fetchCollateral(certResult.fmspc);

      // 5b. Verify collateral certificate chain and signatures
      await this.verifyCertificateChain(collateral);

      // 5c. Check certificate revocation against CRLs
      this.checkCertificateRevocation(collateral);

      // 5d. Verify TCB info collateral signature
      this.verifyTCBInfoSignature(collateral);

      // 5e. Verify QE identity collateral signature
      this.verifyQEIdentitySignature(collateral);

      // 5f. Validate collateral freshness
      this.validateCollateralFreshness(collateral);

      // 5g. Verify QE Report identity against authenticated QE Identity collateral
      this.verifyQEReportIdentity(collateral, certResult);

      // 6. Check TCB status (compares all 16 SGX component SVNs + pceSvn)
      const tcbStatus = await this.evaluateTCBStatus(collateral, header, reportBody);
      this.enforceTCBPolicy(tcbStatus);

      // 7. Verify MRSIGNER trust
      this.verifyMRSIGNERTrust(reportBody.mrsigner);

      // 8. Check ISV SVN
      if (reportBody.isvSvn < MIN_ISV_SVN) {
        throw new AttestationError(
          `ISV SVN ${reportBody.isvSvn} below minimum ${MIN_ISV_SVN}`,
          'TEE_SVN_TOO_LOW',
        );
      }

      // 9. Build result
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ATTESTATION_VALIDITY_HOURS * 3600_000);

      const result: TEEAttestationResult = {
        attestationId,
        verified: true,
        enclaveType: request.enclaveType,
        mrsigner: reportBody.mrsigner,
        mrenclave: reportBody.mrenclave,
        isvProdId: reportBody.isvProdId,
        isvSvn: reportBody.isvSvn,
        tcbStatus,
        advisoryIds: this.getAdvisoryIds(tcbStatus),
        timestamp: now,
        expiresAt,
      };

      // 10. Update identity record
      await prisma.identity.update({
        where: { id: request.identityId },
        data: {
          teeAttested: true,
          teeAttestationId: attestationId,
        },
      });

      // 11. Cache attestation result
      await redis.set(
        `tee:attestation:${attestationId}`,
        JSON.stringify(result),
        'EX',
        ATTESTATION_VALIDITY_HOURS * 3600,
      );

      // 12. Audit log
      await prisma.auditLog.create({
        data: {
          identityId: request.identityId,
          action: 'TEE_ATTESTATION_VERIFIED',
          resourceType: 'attestation',
          resourceId: attestationId,
          details: {
            enclaveType: request.enclaveType,
            mrenclave: reportBody.mrenclave,
            mrsigner: reportBody.mrsigner,
            tcbStatus,
          },
        },
      });

      // Record observability metrics on success
      const durationSec = Number(process.hrtime.bigint() - startTime) / 1e9;
      teeAttestationTotal.inc({ result: 'success', error_code: '' });
      teeAttestationDuration.observe({ result: 'success' }, durationSec);
      teeTCBStatusTotal.inc({ tcb_status: tcbStatus });
      teeFMSPCTotal.inc({ fmspc: certResult.fmspc });
      teeMRSIGNERTotal.inc({ mrsigner: reportBody.mrsigner });

      logger.info('tee_attestation_success', { attestationId, tcbStatus, durationSec });
      return result;
    } catch (err) {
      // Record observability metrics on failure
      const durationSec = Number(process.hrtime.bigint() - startTime) / 1e9;
      const errorCode = err instanceof AttestationError ? err.code : 'UNKNOWN';
      teeAttestationTotal.inc({ result: 'failure', error_code: errorCode });
      teeAttestationDuration.observe({ result: 'failure' }, durationSec);

      logger.error('tee_attestation_failed', {
        attestationId,
        error: (err as Error).message,
        errorCode,
        durationSec,
        identityId: request.identityId,
      });

      await prisma.auditLog.create({
        data: {
          identityId: request.identityId,
          action: 'TEE_ATTESTATION_VERIFIED',
          resourceType: 'attestation',
          resourceId: attestationId,
          details: { error: (err as Error).message, verified: false },
        },
      });

      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Check if an attestation is still valid
  // -------------------------------------------------------------------------
  async isAttestationValid(attestationId: string): Promise<boolean> {
    // Check cache first
    const cached = await redis.get(`tee:attestation:${attestationId}`);
    if (cached) {
      const result = JSON.parse(cached) as TEEAttestationResult;
      return result.verified && new Date(result.expiresAt) > new Date();
    }

    // Fall back to identity lookup
    const identity = await prisma.identity.findFirst({
      where: { teeAttestationId: attestationId, teeAttested: true },
    });

    return identity !== null;
  }

  // -------------------------------------------------------------------------
  // Get attestation details
  // -------------------------------------------------------------------------
  async getAttestation(attestationId: string): Promise<TEEAttestationResult | null> {
    const cached = await redis.get(`tee:attestation:${attestationId}`);
    if (cached) {
      return JSON.parse(cached) as TEEAttestationResult;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Internal: Parse SGX DCAP quote binary
  // -------------------------------------------------------------------------
  private parseQuote(quoteBuffer: Buffer): { header: SGXQuoteHeader; reportBody: SGXReportBody } {
    if (quoteBuffer.length < 436) {
      throw new AttestationError('Quote too short', 'TEE_INVALID_QUOTE');
    }

    const header: SGXQuoteHeader = {
      version: quoteBuffer.readUInt16LE(0),
      attestKeyType: quoteBuffer.readUInt16LE(2),
      teeType: quoteBuffer.readUInt32LE(4),
      qeSvn: quoteBuffer.readUInt16LE(8),
      pceSvn: quoteBuffer.readUInt16LE(10),
      qeVendorId: quoteBuffer.subarray(12, 28).toString('hex'),
    };

    const reportOffset = 48;
    const reportBody: SGXReportBody = {
      cpuSvn: quoteBuffer.subarray(reportOffset, reportOffset + 16).toString('hex'),
      mrenclave: quoteBuffer.subarray(reportOffset + 64, reportOffset + 96).toString('hex'),
      mrsigner: quoteBuffer.subarray(reportOffset + 128, reportOffset + 160).toString('hex'),
      isvProdId: quoteBuffer.readUInt16LE(reportOffset + 256),
      isvSvn: quoteBuffer.readUInt16LE(reportOffset + 258),
      reportData: quoteBuffer.subarray(reportOffset + 320, reportOffset + 384).toString('hex'),
    };

    return { header, reportBody };
  }

  // -------------------------------------------------------------------------
  // Internal: Validate quote structural integrity
  // -------------------------------------------------------------------------
  private validateQuoteStructure(header: SGXQuoteHeader, _reportBody: SGXReportBody): void {
    if (header.version !== 3 && header.version !== 4) {
      throw new AttestationError(
        `Unsupported quote version: ${header.version}`,
        'TEE_UNSUPPORTED_VERSION',
      );
    }

    if (header.attestKeyType !== 2) {
      throw new AttestationError(
        `Unsupported attestation key type: ${header.attestKeyType}`,
        'TEE_UNSUPPORTED_KEY_TYPE',
      );
    }

    // Intel QE vendor ID
    const INTEL_QE_VENDOR = '939a7233f79c4ca9940a0db3957f0607';
    if (header.qeVendorId !== INTEL_QE_VENDOR) {
      throw new AttestationError('Unknown QE vendor', 'TEE_UNKNOWN_QE_VENDOR');
    }
  }

  // -------------------------------------------------------------------------
  // Internal: Verify user data is bound to the public key
  // -------------------------------------------------------------------------
  private verifyUserDataBinding(reportBody: SGXReportBody, publicKey: string): void {
    const keyBuffer = Buffer.from(publicKey, 'base64');
    const expectedHash = this.sha256Hex(keyBuffer).slice(0, 64);

    if (reportBody.reportData.slice(0, 64) !== expectedHash) {
      throw new AttestationError(
        'Report data does not match public key hash',
        'TEE_USER_DATA_MISMATCH',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Internal: Verify the full DCAP certification chain embedded in the quote.
  //
  // Trust chain (each step depends only on already-verified material):
  //   1. PCK cert chain → Intel SGX Root CA (pinned)
  //   2. QE Report Signature verified by PCK cert public key
  //   3. SHA-256(attestation_key || QE_auth_data) == QE Report reportData[0:32]
  //   4. Quote body (header || report body) signature verified by certified
  //      attestation key
  //   5. FMSPC extracted from the now-verified PCK certificate
  //
  // This ensures no quote-supplied material is trusted before it has been
  // authenticated through the Intel-rooted certificate chain.
  // -------------------------------------------------------------------------
  private verifyQuoteCertificationChain(quoteBuffer: Buffer): QuoteCertificationResult {
    const quoteBodyEnd = 432; // header (48) + report body (384)

    // ── Parse quote signature data section ──────────────────────────────
    if (quoteBuffer.length < quoteBodyEnd + 128) {
      throw new AttestationError(
        'Quote too short for signature data',
        'TEE_QUOTE_TRUNCATED',
      );
    }

    // ISV Enclave Report Signature (r || s, 64 bytes)
    const isvSignatureR = quoteBuffer.subarray(quoteBodyEnd, quoteBodyEnd + 32);
    const isvSignatureS = quoteBuffer.subarray(quoteBodyEnd + 32, quoteBodyEnd + 64);

    // Attestation Public Key (x || y, 64 bytes)
    const attestKeyX = quoteBuffer.subarray(quoteBodyEnd + 64, quoteBodyEnd + 96);
    const attestKeyY = quoteBuffer.subarray(quoteBodyEnd + 96, quoteBodyEnd + 128);
    const attestKeyRaw = quoteBuffer.subarray(quoteBodyEnd + 64, quoteBodyEnd + 128);

    // QE Report Body (384 bytes)
    const qeReportOffset = quoteBodyEnd + 128;
    if (quoteBuffer.length < qeReportOffset + 384) {
      throw new AttestationError(
        'Quote too short for QE report body',
        'TEE_QUOTE_TRUNCATED',
      );
    }
    const qeReportBody = quoteBuffer.subarray(qeReportOffset, qeReportOffset + 384);

    // QE Report Signature (r || s, 64 bytes)
    const qeSigOffset = qeReportOffset + 384;
    if (quoteBuffer.length < qeSigOffset + 64) {
      throw new AttestationError(
        'Quote too short for QE report signature',
        'TEE_QUOTE_TRUNCATED',
      );
    }
    const qeSignatureR = quoteBuffer.subarray(qeSigOffset, qeSigOffset + 32);
    const qeSignatureS = quoteBuffer.subarray(qeSigOffset + 32, qeSigOffset + 64);

    // QE Auth Data
    const qeAuthLenOffset = qeSigOffset + 64;
    if (quoteBuffer.length < qeAuthLenOffset + 2) {
      throw new AttestationError(
        'Quote too short for QE auth data length',
        'TEE_QUOTE_TRUNCATED',
      );
    }
    const qeAuthDataLen = quoteBuffer.readUInt16LE(qeAuthLenOffset);
    const qeAuthDataStart = qeAuthLenOffset + 2;
    const qeAuthData = quoteBuffer.subarray(qeAuthDataStart, qeAuthDataStart + qeAuthDataLen);

    // Certification Data
    const certDataTypeOffset = qeAuthDataStart + qeAuthDataLen;
    if (quoteBuffer.length < certDataTypeOffset + 6) {
      throw new AttestationError(
        'Quote too short for certification data header',
        'TEE_QUOTE_TRUNCATED',
      );
    }
    const certDataType = quoteBuffer.readUInt16LE(certDataTypeOffset);
    const certDataSize = quoteBuffer.readUInt32LE(certDataTypeOffset + 2);
    const certDataStart = certDataTypeOffset + 6;

    if (quoteBuffer.length < certDataStart + certDataSize) {
      throw new AttestationError(
        'Quote too short for certification data',
        'TEE_QUOTE_TRUNCATED',
      );
    }

    if (certDataType !== 5) {
      throw new AttestationError(
        `Unsupported certification data type: ${certDataType} (expected 5 = PCK cert chain)`,
        'TEE_UNSUPPORTED_CERT_DATA_TYPE',
      );
    }

    const certChainPem = quoteBuffer.subarray(certDataStart, certDataStart + certDataSize).toString('utf8');
    const certs = this.parsePemChain(certChainPem);
    if (certs.length < 2) {
      throw new AttestationError(
        `PCK cert chain in quote too short: expected at least 2 certificates, got ${certs.length}`,
        'TEE_PCK_CHAIN_INCOMPLETE',
      );
    }

    // ── Step 1: Verify PCK cert chain → Intel Root CA ───────────────────
    const pckLeafCert = new crypto.X509Certificate(certs[0]);
    const pckIntermediateCert = new crypto.X509Certificate(certs[1]);
    const rootCaCert = new crypto.X509Certificate(INTEL_SGX_ROOT_CA_PEM);

    if (!pckIntermediateCert.verify(rootCaCert.publicKey)) {
      throw new AttestationError(
        'PCK intermediate CA certificate is not signed by Intel SGX Root CA',
        'TEE_PCK_INTERMEDIATE_CA_INVALID',
      );
    }
    if (!pckLeafCert.verify(pckIntermediateCert.publicKey)) {
      throw new AttestationError(
        'PCK leaf certificate is not signed by the intermediate CA',
        'TEE_PCK_LEAF_CERT_INVALID',
      );
    }
    this.checkCertificateValidity(pckLeafCert, 'PCK Leaf Certificate');
    this.checkCertificateValidity(pckIntermediateCert, 'PCK Intermediate CA');
    logger.info('quote_pck_cert_chain_verified');

    // ── Step 2: Verify QE Report Signature with verified PCK cert key ───
    const qeReportVerifier = crypto.createVerify('SHA256');
    qeReportVerifier.update(qeReportBody);
    const qeReportDerSig = this.buildDERSignature(qeSignatureR, qeSignatureS);
    const qeReportSigValid = qeReportVerifier.verify(pckLeafCert.publicKey, qeReportDerSig);

    if (!qeReportSigValid) {
      throw new AttestationError(
        'QE Report signature verification failed against PCK certificate',
        'TEE_QE_REPORT_SIGNATURE_INVALID',
      );
    }
    logger.info('quote_qe_report_signature_verified');

    // ── Step 3: Verify attestation key binding in QE Report ─────────────
    // QE Report reportData[0:32] must equal SHA-256(attestation_key || QE_auth_data)
    const bindingHash = crypto.createHash('sha256')
      .update(attestKeyRaw)
      .update(qeAuthData)
      .digest('hex');

    const qeReportDataOffset = 320; // reportData is at offset 320 within report body
    const qeReportData = qeReportBody.subarray(qeReportDataOffset, qeReportDataOffset + 32).toString('hex');

    if (bindingHash !== qeReportData) {
      throw new AttestationError(
        'Attestation key binding mismatch: SHA-256(attest_key || auth_data) does not match QE Report reportData',
        'TEE_ATTEST_KEY_BINDING_INVALID',
      );
    }
    logger.info('quote_attestation_key_binding_verified');

    // ── Step 4: Verify quote body signature with certified attestation key ─
    const signedData = quoteBuffer.subarray(0, quoteBodyEnd);
    const publicKeyDer = this.buildECPublicKeyDer(attestKeyX, attestKeyY);
    const quoteVerifier = crypto.createVerify('SHA256');
    quoteVerifier.update(signedData);
    const isvDerSig = this.buildDERSignature(isvSignatureR, isvSignatureS);
    const quoteSigValid = quoteVerifier.verify(
      { key: publicKeyDer, format: 'der', type: 'spki' },
      isvDerSig,
    );

    if (!quoteSigValid) {
      throw new AttestationError(
        'Quote ECDSA signature verification failed with certified attestation key',
        'TEE_SIGNATURE_INVALID',
      );
    }
    logger.info('quote_signature_verified_with_certified_key');

    // ── Step 5: Extract FMSPC from verified PCK certificate ─────────────
    const fmspc = this.extractFmspcFromPckCert(certs[0]);
    logger.info('fmspc_extracted_from_verified_pck_cert', { fmspc });

    // ── Extract QE Report identity fields for later collateral matching ──
    const qeReportMrenclave = qeReportBody.subarray(64, 96).toString('hex');
    const qeReportMrsigner = qeReportBody.subarray(128, 160).toString('hex');
    const qeReportIsvProdId = qeReportBody.readUInt16LE(256);
    const qeReportIsvSvn = qeReportBody.readUInt16LE(258);

    return {
      fmspc,
      qeReportMrenclave,
      qeReportMrsigner,
      qeReportIsvProdId,
      qeReportIsvSvn,
    };
  }

  // -------------------------------------------------------------------------
  // Internal: Extract FMSPC from PCK certificate SGX Extensions
  //
  // The FMSPC is stored in the PCK certificate's SGX Extensions extension
  // (OID 1.2.840.113741.1.13.1). Within that extension, the FMSPC value
  // is at sub-OID 1.2.840.113741.1.13.1.4 as a 6-byte OCTET STRING.
  //
  // DER encoding of OID 1.2.840.113741.1.13.1.4:
  //   06 0a 2a 86 48 86 f8 4d 01 0d 01 04
  // -------------------------------------------------------------------------
  private extractFmspcFromPckCert(pckCertPem: string): string {
    const cert = new crypto.X509Certificate(pckCertPem);
    // Get the raw DER encoding of the certificate to search for the FMSPC OID
    const derBuffer = Buffer.from(cert.raw);

    // OID 1.2.840.113741.1.13.1.4 in DER encoding
    const fmspcOid = Buffer.from('060a2a864886f84d010d0104', 'hex');

    const oidIndex = this.findBuffer(derBuffer, fmspcOid);
    if (oidIndex === -1) {
      throw new AttestationError(
        'FMSPC OID (1.2.840.113741.1.13.1.4) not found in PCK certificate',
        'TEE_FMSPC_OID_NOT_FOUND',
      );
    }

    // After the OID, the value follows as an OCTET STRING (tag 0x04)
    // Structure: SEQUENCE { OID, OCTET STRING { FMSPC } }
    // We need to find the OCTET STRING after the OID
    let offset = oidIndex + fmspcOid.length;

    // Skip any intermediate wrapper tags to find the OCTET STRING
    // The value may be wrapped in a context-specific tag or directly follow
    const maxSearch = Math.min(offset + 16, derBuffer.length);
    while (offset < maxSearch) {
      if (derBuffer[offset] === 0x04) {
        // OCTET STRING tag found
        const len = derBuffer[offset + 1];
        if (len === 6 && offset + 2 + 6 <= derBuffer.length) {
          const fmspc = derBuffer.subarray(offset + 2, offset + 2 + 6).toString('hex');
          return fmspc;
        }
      }
      offset++;
    }

    throw new AttestationError(
      'Failed to extract FMSPC value from PCK certificate SGX Extensions',
      'TEE_FMSPC_PARSE_FAILED',
    );
  }

  // -------------------------------------------------------------------------
  // Internal: Find a sub-buffer within a buffer
  // -------------------------------------------------------------------------
  private findBuffer(haystack: Buffer, needle: Buffer): number {
    for (let i = 0; i <= haystack.length - needle.length; i++) {
      if (haystack.subarray(i, i + needle.length).equals(needle)) {
        return i;
      }
    }
    return -1;
  }

  // -------------------------------------------------------------------------
  // Internal: Fetch PCCS collateral with persistent Redis cache, background
  // refresh, and fail-closed behavior (TEE-02 audit requirement).
  //
  // Strategy:
  //   1. Check Redis for cached collateral keyed by FMSPC.
  //   2. If cached AND not stale → return immediately.
  //      - If age > COLLATERAL_REFRESH_THRESHOLD (80%) → trigger background refresh.
  //   3. If no cache or stale → fetch synchronously, cache, return.
  //   4. If synchronous fetch fails AND cache is stale → FAIL CLOSED.
  // -------------------------------------------------------------------------
  private async fetchCollateral(fmspc: string): Promise<PCCSCollateral> {
    const cacheKey = `tee:collateral:${fmspc}`;
    const now = Date.now();

    // 1. Attempt to read from Redis cache
    let cached: CachedCollateral | null = null;
    try {
      const raw = await redis.get(cacheKey);
      if (raw) {
        cached = JSON.parse(raw) as CachedCollateral;
      }
    } catch (err) {
      logger.warn('collateral_cache_read_failed', {
        fmspc,
        error: (err as Error).message,
      });
      // Continue — treat as cache miss
    }

    if (cached) {
      const age = now - cached.cachedAt;
      const isStale = age >= MAX_COLLATERAL_AGE_MS || now >= cached.nextUpdate;

      if (!isStale) {
        // Cache hit with valid collateral
        const nearingExpiry = age >= COLLATERAL_REFRESH_THRESHOLD;
        if (nearingExpiry && cached.refreshStatus !== 'refreshing') {
          // Trigger non-blocking background refresh
          logger.info('collateral_background_refresh_triggered', {
            fmspc,
            ageMs: age,
            thresholdMs: COLLATERAL_REFRESH_THRESHOLD,
          });
          this.refreshCollateral(fmspc, cacheKey);
        }
        logger.info('collateral_cache_hit', { fmspc, ageMs: age });
        return cached.collateral;
      }

      // Cached but stale — must fetch synchronously
      logger.warn('collateral_cache_stale', { fmspc, ageMs: age });
    }

    // 2. Synchronous fetch from Intel PCS
    try {
      const collateral = await this.fetchCollateralFromPCS(fmspc);
      await this.cacheCollateral(fmspc, cacheKey, collateral);
      return collateral;
    } catch (fetchErr) {
      // Fetch failed — fail closed (even if stale cache exists)
      logger.error('pccs_collateral_fetch_failed_fail_closed', {
        fmspc,
        error: (fetchErr as Error).message,
        hadStaleCache: cached !== null,
      });
      throw new AttestationError(
        `Failed to fetch PCCS collateral and no valid cache available: ${(fetchErr as Error).message}`,
        'TEE_COLLATERAL_UNAVAILABLE',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Internal: Background refresh — fetches fresh collateral without blocking
  // the attestation flow. Errors are logged but never thrown.
  // -------------------------------------------------------------------------
  private refreshCollateral(fmspc: string, cacheKey: string): void {
    // Mark as refreshing (best-effort, non-blocking)
    redis.get(cacheKey).then((raw) => {
      if (raw) {
        try {
          const entry = JSON.parse(raw) as CachedCollateral;
          entry.refreshStatus = 'refreshing';
          const ttlMs = Math.max(entry.nextUpdate - Date.now(), MAX_COLLATERAL_AGE_MS);
          const ttlSec = Math.ceil(ttlMs / 1000);
          redis.set(cacheKey, JSON.stringify(entry), 'EX', ttlSec).catch(() => {});
        } catch { /* ignore parse errors */ }
      }
    }).catch(() => {});

    setImmediate(() => {
      this.fetchCollateralFromPCS(fmspc)
        .then((collateral) => this.cacheCollateral(fmspc, cacheKey, collateral))
        .then(() => {
          logger.info('collateral_background_refresh_success', { fmspc });
        })
        .catch((err) => {
          logger.error('collateral_background_refresh_failed', {
            fmspc,
            error: (err as Error).message,
          });
          // Old cache remains — do not throw
        });
    });
  }

  // -------------------------------------------------------------------------
  // Internal: Store collateral in Redis with metadata
  // -------------------------------------------------------------------------
  private async cacheCollateral(
    fmspc: string,
    cacheKey: string,
    collateral: PCCSCollateral,
  ): Promise<void> {
    const now = Date.now();

    // Extract issueDate and nextUpdate from tcbInfo
    let issueDate = now;
    let nextUpdate = now + MAX_COLLATERAL_AGE_MS;
    try {
      const tcbInfoWrapper = JSON.parse(collateral.tcbInfo);
      const tcbInfo = tcbInfoWrapper.tcbInfo;
      if (tcbInfo?.issueDate) {
        issueDate = new Date(tcbInfo.issueDate).getTime();
      }
      if (tcbInfo?.nextUpdate) {
        nextUpdate = new Date(tcbInfo.nextUpdate).getTime();
      }
    } catch {
      logger.warn('collateral_cache_metadata_parse_failed', { fmspc });
    }

    const entry: CachedCollateral = {
      collateral,
      fmspc,
      cachedAt: now,
      issueDate,
      nextUpdate,
      refreshStatus: 'fresh',
    };

    // TTL: whichever comes first — nextUpdate or MAX_COLLATERAL_AGE_MS from now.
    // Add a small buffer (10%) so the entry doesn't vanish right at the boundary.
    const ttlFromNextUpdate = nextUpdate - now;
    const ttlMs = Math.min(
      Math.max(ttlFromNextUpdate, 0) + Math.ceil(MAX_COLLATERAL_AGE_MS * 0.1),
      MAX_COLLATERAL_AGE_MS + Math.ceil(MAX_COLLATERAL_AGE_MS * 0.1),
    );
    const ttlSec = Math.max(Math.ceil(ttlMs / 1000), 60); // at least 60 s

    try {
      await redis.set(cacheKey, JSON.stringify(entry), 'EX', ttlSec);
      logger.info('collateral_cached', { fmspc, ttlSec, issueDate, nextUpdate });
    } catch (err) {
      logger.warn('collateral_cache_write_failed', {
        fmspc,
        error: (err as Error).message,
      });
      // Non-fatal — the collateral is still usable for this request
    }
  }

  // -------------------------------------------------------------------------
  // Internal: Fetch PCCS collateral from Intel PCS (raw network call)
  // -------------------------------------------------------------------------
  private async fetchCollateralFromPCS(fmspc: string): Promise<PCCSCollateral> {
    const headers: Record<string, string> = {
      'Ocp-Apim-Subscription-Key': INTEL_PCS_API_KEY,
    };

    try {
      const [pckCrlRes, rootCaCrlRes, tcbInfoRes, qeIdentityRes] = await Promise.all([
        fetch(`${TEE_DCAP_BASE_URL}/pckcrl?ca=processor`, { headers }),
        fetch(`${TEE_DCAP_BASE_URL}/rootcacrl`, { headers }),
        fetch(`${TEE_DCAP_BASE_URL}/tcb?fmspc=${fmspc}`, { headers }),
        fetch(`${TEE_DCAP_BASE_URL}/qe/identity`, { headers }),
      ]);

      if (!pckCrlRes.ok) {
        throw new Error(`PCK CRL fetch returned HTTP ${pckCrlRes.status}`);
      }
      if (!rootCaCrlRes.ok) {
        throw new Error(`Root CA CRL fetch returned HTTP ${rootCaCrlRes.status}`);
      }
      if (!tcbInfoRes.ok) {
        throw new Error(`TCB info fetch returned HTTP ${tcbInfoRes.status}`);
      }
      if (!qeIdentityRes.ok) {
        throw new Error(`QE identity fetch returned HTTP ${qeIdentityRes.status}`);
      }

      // Extract PCK CRL issuer chain from response header
      const pckCrlIssuerChain = decodeURIComponent(
        pckCrlRes.headers.get('SGX-PCK-CRL-Issuer-Chain') ?? '',
      );

      // Extract TCB info signature from response header
      const tcbInfoSignature = tcbInfoRes.headers.get('SGX-TCB-Info-Signature') ?? '';
      // Extract the TCB signing certificate chain from response header
      const tcbSigningCertChain = decodeURIComponent(
        tcbInfoRes.headers.get('SGX-TCB-Info-Issuer-Chain') ?? '',
      );

      // Extract QE identity signature and signing cert chain from response headers
      const qeIdentitySignature = qeIdentityRes.headers.get('SGX-Enclave-Identity-Signature') ?? '';
      const qeIdentitySigningCertChain = decodeURIComponent(
        qeIdentityRes.headers.get('SGX-Enclave-Identity-Issuer-Chain') ?? '',
      );

      logger.info('pccs_collateral_fetched', { fmspc });

      return {
        pckCrl: await pckCrlRes.text(),
        pckCrlIssuerChain,
        rootCaCrl: await rootCaCrlRes.text(),
        tcbInfo: await tcbInfoRes.text(),
        tcbInfoSignature,
        tcbSigningCertChain,
        qeIdentity: await qeIdentityRes.text(),
        qeIdentitySignature,
        qeIdentitySigningCertChain,
      };
    } catch (err) {
      logger.error('pccs_collateral_fetch_failed', { error: (err as Error).message });
      throw new AttestationError(
        `Failed to fetch PCCS collateral: ${(err as Error).message}`,
        'TEE_COLLATERAL_UNAVAILABLE',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Internal: Verify Intel certificate chain with cryptographic validation
  // -------------------------------------------------------------------------
  private async verifyCertificateChain(collateral: PCCSCollateral): Promise<void> {
    if (!collateral.pckCrl || !collateral.rootCaCrl || !collateral.tcbInfo || !collateral.qeIdentity) {
      throw new AttestationError(
        'Incomplete collateral: pckCrl, rootCaCrl, tcbInfo, and qeIdentity are all required',
        'TEE_CHAIN_INCOMPLETE',
      );
    }

    // Parse the pinned Intel SGX Root CA
    const rootCaCert = new crypto.X509Certificate(INTEL_SGX_ROOT_CA_PEM);

    // Verify Root CA is self-signed
    if (!rootCaCert.verify(rootCaCert.publicKey)) {
      throw new AttestationError(
        'Intel SGX Root CA failed self-signature verification',
        'TEE_ROOT_CA_INVALID',
      );
    }
    logger.info('certificate_chain_root_ca_verified');

    // Check Root CA validity period
    this.checkCertificateValidity(rootCaCert, 'Intel SGX Root CA');

    // Extract the TCB signing certificate chain (contains Intermediate CA and leaf)
    if (!collateral.tcbSigningCertChain) {
      throw new AttestationError(
        'TCB signing certificate chain not present in collateral',
        'TEE_CHAIN_INCOMPLETE',
      );
    }

    const chainCerts = this.parsePemChain(collateral.tcbSigningCertChain);
    if (chainCerts.length < 2) {
      throw new AttestationError(
        `Certificate chain too short: expected at least 2 certificates, got ${chainCerts.length}`,
        'TEE_CHAIN_INCOMPLETE',
      );
    }

    // The chain typically contains [leaf (TCB signing cert), intermediate CA]
    const leafCert = new crypto.X509Certificate(chainCerts[0]);
    const intermediateCaCert = new crypto.X509Certificate(chainCerts[1]);

    // Verify Intermediate CA is signed by Root CA
    if (!intermediateCaCert.verify(rootCaCert.publicKey)) {
      throw new AttestationError(
        'Intel SGX Intermediate CA certificate is not signed by the Root CA',
        'TEE_INTERMEDIATE_CA_INVALID',
      );
    }
    logger.info('certificate_chain_intermediate_ca_verified');

    // Check Intermediate CA validity period
    this.checkCertificateValidity(intermediateCaCert, 'Intel SGX Intermediate CA');

    // Verify the leaf (PCK / TCB signing) certificate is signed by Intermediate CA
    if (!leafCert.verify(intermediateCaCert.publicKey)) {
      throw new AttestationError(
        'Leaf certificate is not signed by the Intel SGX Intermediate CA',
        'TEE_LEAF_CERT_INVALID',
      );
    }
    logger.info('certificate_chain_leaf_cert_verified');

    // Check leaf certificate validity period
    this.checkCertificateValidity(leafCert, 'TCB Signing Certificate');

    // Validate tcbInfo JSON structure
    try {
      const tcbInfo = JSON.parse(collateral.tcbInfo);
      if (!tcbInfo.tcbInfo?.tcbLevels || !Array.isArray(tcbInfo.tcbInfo.tcbLevels)) {
        throw new Error('Missing tcbLevels');
      }
      if (!tcbInfo.tcbInfo?.fmspc) {
        throw new Error('Missing fmspc');
      }
    } catch (err) {
      if (err instanceof AttestationError) throw err;
      throw new AttestationError(
        `Invalid tcbInfo structure: ${(err as Error).message}`,
        'TEE_INVALID_TCB_INFO',
      );
    }

    // Validate qeIdentity JSON structure (cryptographic verification is done
    // separately in verifyQEIdentitySignature)
    try {
      const qeId = JSON.parse(collateral.qeIdentity);
      if (!qeId.enclaveIdentity) {
        throw new Error('Missing enclaveIdentity');
      }
      if (!qeId.enclaveIdentity.id || !qeId.enclaveIdentity.tcbLevels) {
        throw new Error('Missing enclaveIdentity.id or enclaveIdentity.tcbLevels');
      }
    } catch (err) {
      if (err instanceof AttestationError) throw err;
      throw new AttestationError(
        `Invalid qeIdentity structure: ${(err as Error).message}`,
        'TEE_INVALID_QE_IDENTITY',
      );
    }

    logger.info('certificate_chain_fully_verified');
  }

  // -------------------------------------------------------------------------
  // Internal: Check certificate validity period (notBefore / notAfter)
  // -------------------------------------------------------------------------
  private checkCertificateValidity(cert: crypto.X509Certificate, label: string): void {
    const now = new Date();
    const notBefore = new Date(cert.validFrom);
    const notAfter = new Date(cert.validTo);

    if (now < notBefore) {
      throw new AttestationError(
        `${label} is not yet valid (notBefore: ${cert.validFrom})`,
        'TEE_CERT_NOT_YET_VALID',
      );
    }

    if (now > notAfter) {
      throw new AttestationError(
        `${label} has expired (notAfter: ${cert.validTo})`,
        'TEE_CERT_EXPIRED',
      );
    }

    logger.info('certificate_validity_checked', { label, validFrom: cert.validFrom, validTo: cert.validTo });
  }

  // -------------------------------------------------------------------------
  // Internal: Parse a PEM chain (multiple concatenated PEM blocks)
  // -------------------------------------------------------------------------
  private parsePemChain(pemChain: string): string[] {
    const certs: string[] = [];
    const regex = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(pemChain)) !== null) {
      certs.push(match[0]);
    }
    return certs;
  }

  // -------------------------------------------------------------------------
  // Internal: Check certificate revocation against CRLs
  //
  // Each CRL is cryptographically verified against its issuing CA before
  // the revoked-serial check. The PCK CRL is signed by the Intermediate
  // CA (from the PCK CRL issuer chain), and the Root CA CRL is self-signed
  // by the Root CA. CRL freshness is also enforced via thisUpdate/nextUpdate.
  // -------------------------------------------------------------------------
  private checkCertificateRevocation(collateral: PCCSCollateral): void {
    logger.info('certificate_revocation_check_start');

    const rootCaCert = new crypto.X509Certificate(INTEL_SGX_ROOT_CA_PEM);

    // ── Authenticate and parse the Root CA CRL ─────────────────────────
    const rootCrlDer = this.parseCrlToDer(collateral.rootCaCrl, 'Root CA CRL');
    this.verifyCrlSignature(rootCrlDer, rootCaCert, 'Root CA CRL');
    this.validateCrlFreshness(rootCrlDer, 'Root CA CRL');
    const rootRevokedSerials = this.extractRevokedSerialsFromDer(rootCrlDer);

    // ── Authenticate and parse the PCK CRL ─────────────────────────────
    // The PCK CRL is signed by the Intermediate CA from the issuer chain
    let pckCrlSigningCert: crypto.X509Certificate;
    if (collateral.pckCrlIssuerChain) {
      const issuerCerts = this.parsePemChain(collateral.pckCrlIssuerChain);
      if (issuerCerts.length < 1) {
        throw new AttestationError(
          'PCK CRL issuer chain is empty',
          'TEE_PCK_CRL_ISSUER_MISSING',
        );
      }
      // The first cert in the chain is typically the Intermediate CA that signed the CRL
      pckCrlSigningCert = new crypto.X509Certificate(issuerCerts[0]);

      // Verify the PCK CRL signing cert chains to Root CA
      // If chain has 2 certs: [intermediate, root]; if 1: [intermediate] (verify against pinned root)
      if (issuerCerts.length >= 2) {
        const issuerRoot = new crypto.X509Certificate(issuerCerts[issuerCerts.length - 1]);
        if (!issuerRoot.verify(rootCaCert.publicKey)) {
          throw new AttestationError(
            'PCK CRL issuer chain root does not match Intel SGX Root CA',
            'TEE_PCK_CRL_ISSUER_ROOT_INVALID',
          );
        }
      }
      if (!pckCrlSigningCert.verify(rootCaCert.publicKey)) {
        // Try verifying against intermediate if available
        let verified = false;
        if (issuerCerts.length >= 2) {
          const intermediateCa = new crypto.X509Certificate(issuerCerts[1]);
          verified = pckCrlSigningCert.verify(intermediateCa.publicKey);
        }
        if (!verified) {
          throw new AttestationError(
            'PCK CRL signing certificate is not anchored to Intel SGX Root CA',
            'TEE_PCK_CRL_ISSUER_INVALID',
          );
        }
      }
      this.checkCertificateValidity(pckCrlSigningCert, 'PCK CRL Signing Certificate');
    } else {
      // Fallback: use Root CA as CRL signer (some PCCS implementations)
      pckCrlSigningCert = rootCaCert;
    }

    const pckCrlDer = this.parseCrlToDer(collateral.pckCrl, 'PCK CRL');
    this.verifyCrlSignature(pckCrlDer, pckCrlSigningCert, 'PCK CRL');
    this.validateCrlFreshness(pckCrlDer, 'PCK CRL');
    const pckRevokedSerials = this.extractRevokedSerialsFromDer(pckCrlDer);

    // ── Check TCB signing cert chain against both CRLs ─────────────────
    if (collateral.tcbSigningCertChain) {
      const chainCerts = this.parsePemChain(collateral.tcbSigningCertChain);
      if (chainCerts.length > 0) {
        const leafCert = new crypto.X509Certificate(chainCerts[0]);
        const leafSerial = leafCert.serialNumber.toLowerCase();

        if (pckRevokedSerials.has(leafSerial)) {
          throw new AttestationError(
            `TCB signing certificate (serial: ${leafSerial}) is revoked in PCK CRL`,
            'TEE_CERT_REVOKED',
          );
        }
        if (rootRevokedSerials.has(leafSerial)) {
          throw new AttestationError(
            `TCB signing certificate (serial: ${leafSerial}) is revoked in Root CA CRL`,
            'TEE_CERT_REVOKED',
          );
        }

        // Check intermediate CA serial against root CRL
        if (chainCerts.length > 1) {
          const intermediateCert = new crypto.X509Certificate(chainCerts[1]);
          const intermediateSerial = intermediateCert.serialNumber.toLowerCase();
          if (rootRevokedSerials.has(intermediateSerial)) {
            throw new AttestationError(
              `Intermediate CA certificate (serial: ${intermediateSerial}) is revoked in Root CA CRL`,
              'TEE_CERT_REVOKED',
            );
          }
        }
      }
    }

    logger.info('certificate_revocation_check_passed');
  }

  // -------------------------------------------------------------------------
  // Internal: Parse CRL data (PEM or hex-encoded DER) into a DER buffer
  // -------------------------------------------------------------------------
  private parseCrlToDer(crlData: string, label: string): Buffer {
    if (!crlData || crlData.trim().length === 0) {
      throw new AttestationError(
        `${label} is empty or missing`,
        'TEE_CRL_MISSING',
      );
    }

    if (crlData.includes('BEGIN X509 CRL')) {
      const base64 = crlData
        .replace(/-----BEGIN X509 CRL-----/, '')
        .replace(/-----END X509 CRL-----/, '')
        .replace(/\s/g, '');
      return Buffer.from(base64, 'base64');
    }

    // Assume hex-encoded DER (Intel PCS default format)
    const derBuffer = Buffer.from(crlData, 'hex');
    if (derBuffer.length < 10) {
      throw new AttestationError(
        `${label} does not appear to be a valid CRL (too short)`,
        'TEE_INVALID_CRL',
      );
    }
    return derBuffer;
  }

  // -------------------------------------------------------------------------
  // Internal: Verify CRL signature against the issuing CA's public key
  //
  // CRL DER structure:
  //   SEQUENCE {
  //     tbsCertList    SEQUENCE { ... }
  //     signatureAlgorithm SEQUENCE { OID, ... }
  //     signatureValue BIT STRING
  //   }
  // The signature is computed over the raw DER encoding of tbsCertList.
  // -------------------------------------------------------------------------
  private verifyCrlSignature(
    crlDer: Buffer,
    issuerCert: crypto.X509Certificate,
    label: string,
  ): void {
    // Parse outer SEQUENCE to extract tbsCertList and signature
    const parsed = this.parseCrlDerStructure(crlDer);
    if (!parsed) {
      throw new AttestationError(
        `${label}: failed to parse CRL DER structure for signature verification`,
        'TEE_CRL_PARSE_FAILED',
      );
    }

    const { tbsCertListDer, signatureAlgorithmOid, signatureBits } = parsed;

    // Map the signature algorithm OID to a Node.js hash algorithm
    const hashAlg = this.oidToHashAlgorithm(signatureAlgorithmOid);
    if (!hashAlg) {
      throw new AttestationError(
        `${label}: unsupported CRL signature algorithm OID: ${signatureAlgorithmOid}`,
        'TEE_CRL_UNSUPPORTED_ALG',
      );
    }

    const verifier = crypto.createVerify(hashAlg);
    verifier.update(tbsCertListDer);

    // For ECDSA signatures (Intel SGX uses P-256), the signature in the
    // BIT STRING is DER-encoded already.
    const isValid = verifier.verify(issuerCert.publicKey, signatureBits);
    if (!isValid) {
      throw new AttestationError(
        `${label}: CRL signature verification failed — CRL may be tampered`,
        'TEE_CRL_SIGNATURE_INVALID',
      );
    }

    logger.info('crl_signature_verified', { label });
  }

  // -------------------------------------------------------------------------
  // Internal: Parse the top-level CRL DER to extract tbsCertList, algorithm,
  // and signature for verification.
  // -------------------------------------------------------------------------
  private parseCrlDerStructure(
    crlDer: Buffer,
  ): { tbsCertListDer: Buffer; signatureAlgorithmOid: string; signatureBits: Buffer } | null {
    let offset = 0;

    // Outer SEQUENCE
    if (crlDer[offset] !== 0x30) return null;
    const outerLen = this.parseDerLength(crlDer, offset + 1);
    if (!outerLen) return null;
    offset = outerLen.contentStart;

    // First element: tbsCertList SEQUENCE
    if (crlDer[offset] !== 0x30) return null;
    const tbsLen = this.parseDerLength(crlDer, offset + 1);
    if (!tbsLen) return null;
    // tbsCertListDer includes the tag and length bytes
    const tbsCertListDer = crlDer.subarray(offset, tbsLen.contentStart + tbsLen.length);
    offset = tbsLen.contentStart + tbsLen.length;

    // Second element: signatureAlgorithm SEQUENCE
    if (crlDer[offset] !== 0x30) return null;
    const algLen = this.parseDerLength(crlDer, offset + 1);
    if (!algLen) return null;
    // Extract OID from within the algorithm SEQUENCE
    const algContentStart = algLen.contentStart;
    let signatureAlgorithmOid = '';
    if (crlDer[algContentStart] === 0x06) {
      const oidLen = crlDer[algContentStart + 1];
      const oidBytes = crlDer.subarray(algContentStart + 2, algContentStart + 2 + oidLen);
      signatureAlgorithmOid = this.derOidToString(oidBytes);
    }
    offset = algLen.contentStart + algLen.length;

    // Third element: signatureValue BIT STRING
    if (crlDer[offset] !== 0x03) return null;
    const sigLen = this.parseDerLength(crlDer, offset + 1);
    if (!sigLen) return null;
    // BIT STRING has a leading unused-bits byte (should be 0x00)
    const signatureBits = crlDer.subarray(sigLen.contentStart + 1, sigLen.contentStart + sigLen.length);

    return { tbsCertListDer, signatureAlgorithmOid, signatureBits };
  }

  // -------------------------------------------------------------------------
  // Internal: Parse DER length encoding, return content start and length
  // -------------------------------------------------------------------------
  private parseDerLength(buf: Buffer, offset: number): { contentStart: number; length: number } | null {
    if (offset >= buf.length) return null;
    const firstByte = buf[offset];
    if (!(firstByte & 0x80)) {
      return { contentStart: offset + 1, length: firstByte };
    }
    const numLenBytes = firstByte & 0x7f;
    if (numLenBytes > 4 || offset + 1 + numLenBytes > buf.length) return null;
    let length = 0;
    for (let i = 0; i < numLenBytes; i++) {
      length = (length << 8) | buf[offset + 1 + i];
    }
    return { contentStart: offset + 1 + numLenBytes, length };
  }

  // -------------------------------------------------------------------------
  // Internal: Convert DER-encoded OID bytes to dotted-decimal string
  // -------------------------------------------------------------------------
  private derOidToString(oidBytes: Buffer): string {
    if (oidBytes.length === 0) return '';
    const components: number[] = [];
    // First byte encodes first two components: first = floor(byte/40), second = byte%40
    components.push(Math.floor(oidBytes[0] / 40));
    components.push(oidBytes[0] % 40);
    let value = 0;
    for (let i = 1; i < oidBytes.length; i++) {
      value = (value << 7) | (oidBytes[i] & 0x7f);
      if (!(oidBytes[i] & 0x80)) {
        components.push(value);
        value = 0;
      }
    }
    return components.join('.');
  }

  // -------------------------------------------------------------------------
  // Internal: Map signature algorithm OID to Node.js hash name
  // -------------------------------------------------------------------------
  private oidToHashAlgorithm(oid: string): string | null {
    const map: Record<string, string> = {
      '1.2.840.10045.4.3.2': 'SHA256',   // ecdsa-with-SHA256
      '1.2.840.10045.4.3.3': 'SHA384',   // ecdsa-with-SHA384
      '1.2.840.10045.4.3.4': 'SHA512',   // ecdsa-with-SHA512
      '1.2.840.113549.1.1.11': 'SHA256',  // sha256WithRSAEncryption
      '1.2.840.113549.1.1.12': 'SHA384',  // sha384WithRSAEncryption
      '1.2.840.113549.1.1.13': 'SHA512',  // sha512WithRSAEncryption
    };
    return map[oid] ?? null;
  }

  // -------------------------------------------------------------------------
  // Internal: Validate CRL freshness via thisUpdate/nextUpdate in the DER
  //
  // tbsCertList contains: version, signature, issuer, thisUpdate, nextUpdate, ...
  // We parse just enough to extract the two time fields.
  // -------------------------------------------------------------------------
  private validateCrlFreshness(crlDer: Buffer, label: string): void {
    const times = this.extractCrlTimes(crlDer);
    if (!times) {
      logger.warn('crl_freshness_times_not_parsed', { label });
      return; // Best-effort; signature verification is the primary gate
    }

    const now = Date.now();
    const { thisUpdate, nextUpdate } = times;

    if (thisUpdate > now) {
      throw new AttestationError(
        `${label}: thisUpdate is in the future (${new Date(thisUpdate).toISOString()})`,
        'TEE_CRL_FUTURE_DATE',
      );
    }

    if (nextUpdate && nextUpdate <= now) {
      throw new AttestationError(
        `${label}: CRL has expired (nextUpdate: ${new Date(nextUpdate).toISOString()})`,
        'TEE_CRL_EXPIRED',
      );
    }

    const ageDays = Math.floor((now - thisUpdate) / (24 * 60 * 60 * 1000));
    const maxAgeDays = Math.floor(MAX_COLLATERAL_AGE_MS / (24 * 60 * 60 * 1000));
    if (now - thisUpdate > MAX_COLLATERAL_AGE_MS) {
      throw new AttestationError(
        `${label}: CRL is stale (thisUpdate: ${ageDays} days ago, max: ${maxAgeDays} days)`,
        'TEE_CRL_STALE',
      );
    }

    logger.info('crl_freshness_validated', { label, ageDays });
  }

  // -------------------------------------------------------------------------
  // Internal: Extract thisUpdate and nextUpdate times from CRL DER
  // -------------------------------------------------------------------------
  private extractCrlTimes(crlDer: Buffer): { thisUpdate: number; nextUpdate?: number } | null {
    // Navigate: outer SEQUENCE → tbsCertList SEQUENCE → skip version, sigAlg, issuer → times
    let offset = 0;
    if (crlDer[offset] !== 0x30) return null;
    const outerLen = this.parseDerLength(crlDer, offset + 1);
    if (!outerLen) return null;
    offset = outerLen.contentStart;

    // tbsCertList SEQUENCE
    if (crlDer[offset] !== 0x30) return null;
    const tbsLen = this.parseDerLength(crlDer, offset + 1);
    if (!tbsLen) return null;
    let tbsOffset = tbsLen.contentStart;
    const tbsEnd = tbsLen.contentStart + tbsLen.length;

    // Optional version (context tag [0])
    if (crlDer[tbsOffset] === 0xa0) {
      const vLen = this.parseDerLength(crlDer, tbsOffset + 1);
      if (!vLen) return null;
      tbsOffset = vLen.contentStart + vLen.length;
    }

    // Skip signature algorithm SEQUENCE
    if (crlDer[tbsOffset] !== 0x30) return null;
    const sigAlgLen = this.parseDerLength(crlDer, tbsOffset + 1);
    if (!sigAlgLen) return null;
    tbsOffset = sigAlgLen.contentStart + sigAlgLen.length;

    // Skip issuer SEQUENCE
    if (crlDer[tbsOffset] !== 0x30) return null;
    const issuerLen = this.parseDerLength(crlDer, tbsOffset + 1);
    if (!issuerLen) return null;
    tbsOffset = issuerLen.contentStart + issuerLen.length;

    // thisUpdate (UTCTime 0x17 or GeneralizedTime 0x18)
    const thisUpdateTime = this.parseAsn1Time(crlDer, tbsOffset);
    if (!thisUpdateTime) return null;
    tbsOffset = thisUpdateTime.nextOffset;

    // nextUpdate (optional, same time types)
    let nextUpdate: number | undefined;
    if (tbsOffset < tbsEnd) {
      const nextUpdateTime = this.parseAsn1Time(crlDer, tbsOffset);
      if (nextUpdateTime) {
        nextUpdate = nextUpdateTime.time;
      }
    }

    return { thisUpdate: thisUpdateTime.time, nextUpdate };
  }

  // -------------------------------------------------------------------------
  // Internal: Parse ASN.1 UTCTime (0x17) or GeneralizedTime (0x18)
  // -------------------------------------------------------------------------
  private parseAsn1Time(buf: Buffer, offset: number): { time: number; nextOffset: number } | null {
    const tag = buf[offset];
    if (tag !== 0x17 && tag !== 0x18) return null;
    const len = buf[offset + 1];
    const timeStr = buf.subarray(offset + 2, offset + 2 + len).toString('ascii');

    let dateStr: string;
    if (tag === 0x17) {
      // UTCTime: YYMMDDHHMMSSZ
      const yy = parseInt(timeStr.substring(0, 2), 10);
      const year = yy >= 50 ? 1900 + yy : 2000 + yy;
      dateStr = `${year}-${timeStr.substring(2, 4)}-${timeStr.substring(4, 6)}T${timeStr.substring(6, 8)}:${timeStr.substring(8, 10)}:${timeStr.substring(10, 12)}Z`;
    } else {
      // GeneralizedTime: YYYYMMDDHHMMSSZ
      dateStr = `${timeStr.substring(0, 4)}-${timeStr.substring(4, 6)}-${timeStr.substring(6, 8)}T${timeStr.substring(8, 10)}:${timeStr.substring(10, 12)}:${timeStr.substring(12, 14)}Z`;
    }

    const time = new Date(dateStr).getTime();
    if (isNaN(time)) return null;
    return { time, nextOffset: offset + 2 + len };
  }

  // -------------------------------------------------------------------------
  // Internal: Extract revoked serial numbers from pre-parsed DER buffer
  // -------------------------------------------------------------------------
  private extractRevokedSerialsFromDer(crlDer: Buffer): Set<string> {
    const serials = new Set<string>();
    try {
      this.parseDerCrlSerials(crlDer, 0, crlDer.length, serials);
    } catch (err) {
      logger.warn('crl_serial_extraction_partial', { error: (err as Error).message });
    }
    return serials;
  }

  // -------------------------------------------------------------------------
  // Internal: Walk DER-encoded CRL to extract revoked serial numbers
  //
  // This does a recursive walk of ASN.1 SEQUENCE structures to find
  // INTEGER values that represent revoked certificate serials within the
  // revokedCertificates list.
  // -------------------------------------------------------------------------
  private parseDerCrlSerials(
    buf: Buffer,
    offset: number,
    end: number,
    serials: Set<string>,
    depth: number = 0,
  ): void {
    while (offset < end) {
      if (offset + 2 > end) break;

      const tag = buf[offset];
      offset += 1;

      // Parse length
      let length: number;
      if (buf[offset] & 0x80) {
        const numLenBytes = buf[offset] & 0x7f;
        offset += 1;
        if (numLenBytes > 4 || offset + numLenBytes > end) break;
        length = 0;
        for (let i = 0; i < numLenBytes; i++) {
          length = (length << 8) | buf[offset + i];
        }
        offset += numLenBytes;
      } else {
        length = buf[offset];
        offset += 1;
      }

      if (offset + length > end) break;

      const contentEnd = offset + length;

      // SEQUENCE (0x30) - recurse into it
      if (tag === 0x30) {
        this.parseDerCrlSerials(buf, offset, contentEnd, serials, depth + 1);
      }
      // INTEGER (0x02) at depth >= 3 is likely a revoked serial number
      // (depth 0=outer, 1=tbsCertList, 2=revokedCertificates SEQUENCE, 3=per-entry SEQUENCE)
      else if (tag === 0x02 && depth >= 3) {
        const serial = buf.subarray(offset, contentEnd).toString('hex').toLowerCase();
        serials.add(serial);
      }

      offset = contentEnd;
    }
  }

  // -------------------------------------------------------------------------
  // Internal: Verify TCB info response signature
  //
  // Intel PCS returns the TCB info as JSON, with the signature in the
  // SGX-TCB-Info-Signature response header (hex-encoded ECDSA signature).
  // The signed content is the raw JSON body of the tcbInfo field.
  // -------------------------------------------------------------------------
  private verifyTCBInfoSignature(collateral: PCCSCollateral): void {
    if (!collateral.tcbInfoSignature) {
      throw new AttestationError(
        'TCB info signature is missing from collateral response headers',
        'TEE_TCB_SIGNATURE_MISSING',
      );
    }

    if (!collateral.tcbSigningCertChain) {
      throw new AttestationError(
        'TCB signing certificate chain is missing from collateral response headers',
        'TEE_TCB_SIGNING_CHAIN_MISSING',
      );
    }

    // Parse the signing certificate (first in the chain)
    const chainCerts = this.parsePemChain(collateral.tcbSigningCertChain);
    if (chainCerts.length === 0) {
      throw new AttestationError(
        'TCB signing certificate chain is empty',
        'TEE_TCB_SIGNING_CHAIN_EMPTY',
      );
    }

    const signingCert = new crypto.X509Certificate(chainCerts[0]);

    // Verify the signing certificate chains to Intel Root CA
    // (already done in verifyCertificateChain, but verify the signing cert
    // specifically has appropriate key usage)
    this.checkCertificateValidity(signingCert, 'TCB Info Signing Certificate');

    // The signature is hex-encoded ECDSA over the raw tcbInfo JSON body
    const signatureBuffer = Buffer.from(collateral.tcbInfoSignature, 'hex');

    // The signed data is the raw JSON body (the full tcbInfo response)
    const signedData = Buffer.from(collateral.tcbInfo, 'utf8');

    // Verify ECDSA signature using the signing certificate's public key
    const verifier = crypto.createVerify('SHA256');
    verifier.update(signedData);

    // Convert raw r||s signature (64 bytes for P-256) to DER format
    let derSignature: Buffer;
    if (signatureBuffer.length === 64) {
      const r = signatureBuffer.subarray(0, 32);
      const s = signatureBuffer.subarray(32, 64);
      derSignature = this.buildDERSignature(r, s);
    } else {
      // Already DER-encoded
      derSignature = signatureBuffer;
    }

    const isValid = verifier.verify(signingCert.publicKey, derSignature);
    if (!isValid) {
      throw new AttestationError(
        'TCB info signature verification failed - collateral may be tampered',
        'TEE_TCB_SIGNATURE_INVALID',
      );
    }

    logger.info('tcb_info_signature_verified');
  }

  // -------------------------------------------------------------------------
  // Internal: Verify QE identity response signature
  //
  // Intel PCS returns the QE identity as JSON, with the signature in the
  // SGX-Enclave-Identity-Signature response header (hex-encoded ECDSA) and
  // the signing certificate chain in SGX-Enclave-Identity-Issuer-Chain.
  // The signed content is the raw JSON body of the enclaveIdentity field.
  // -------------------------------------------------------------------------
  private verifyQEIdentitySignature(collateral: PCCSCollateral): void {
    if (!collateral.qeIdentitySignature) {
      throw new AttestationError(
        'QE identity signature is missing from collateral response headers',
        'TEE_QE_SIGNATURE_MISSING',
      );
    }

    if (!collateral.qeIdentitySigningCertChain) {
      throw new AttestationError(
        'QE identity signing certificate chain is missing from collateral response headers',
        'TEE_QE_SIGNING_CHAIN_MISSING',
      );
    }

    // Parse the signing certificate chain
    const chainCerts = this.parsePemChain(collateral.qeIdentitySigningCertChain);
    if (chainCerts.length < 2) {
      throw new AttestationError(
        `QE identity signing certificate chain too short: expected at least 2 certificates, got ${chainCerts.length}`,
        'TEE_QE_SIGNING_CHAIN_INCOMPLETE',
      );
    }

    const signingCert = new crypto.X509Certificate(chainCerts[0]);
    const intermediateCert = new crypto.X509Certificate(chainCerts[1]);
    const rootCaCert = new crypto.X509Certificate(INTEL_SGX_ROOT_CA_PEM);

    // Verify the signing cert chain: leaf → intermediate → root
    if (!intermediateCert.verify(rootCaCert.publicKey)) {
      throw new AttestationError(
        'QE identity intermediate CA is not signed by Intel SGX Root CA',
        'TEE_QE_INTERMEDIATE_CA_INVALID',
      );
    }

    if (!signingCert.verify(intermediateCert.publicKey)) {
      throw new AttestationError(
        'QE identity signing certificate is not signed by the intermediate CA',
        'TEE_QE_SIGNING_CERT_INVALID',
      );
    }

    // Check certificate validity
    this.checkCertificateValidity(signingCert, 'QE Identity Signing Certificate');
    this.checkCertificateValidity(intermediateCert, 'QE Identity Intermediate CA');

    // Verify ECDSA signature over the QE identity JSON body
    const signatureBuffer = Buffer.from(collateral.qeIdentitySignature, 'hex');
    const signedData = Buffer.from(collateral.qeIdentity, 'utf8');

    const verifier = crypto.createVerify('SHA256');
    verifier.update(signedData);

    // Convert raw r||s signature (64 bytes for P-256) to DER format
    let derSignature: Buffer;
    if (signatureBuffer.length === 64) {
      const r = signatureBuffer.subarray(0, 32);
      const s = signatureBuffer.subarray(32, 64);
      derSignature = this.buildDERSignature(r, s);
    } else {
      derSignature = signatureBuffer;
    }

    const isValid = verifier.verify(signingCert.publicKey, derSignature);
    if (!isValid) {
      throw new AttestationError(
        'QE identity signature verification failed - collateral may be tampered',
        'TEE_QE_SIGNATURE_INVALID',
      );
    }

    logger.info('qe_identity_signature_verified');
  }

  // -------------------------------------------------------------------------
  // Internal: Validate collateral freshness
  //
  // Ensures that fetched collateral is not stale. Checks:
  // - tcbInfo.issueDate is within MAX_COLLATERAL_AGE_MS
  // - tcbInfo.nextUpdate is in the future
  // -------------------------------------------------------------------------
  private validateCollateralFreshness(collateral: PCCSCollateral): void {
    const now = Date.now();

    try {
      const tcbInfoWrapper = JSON.parse(collateral.tcbInfo);
      const tcbInfo = tcbInfoWrapper.tcbInfo;

      if (!tcbInfo) {
        throw new AttestationError(
          'TCB info payload missing tcbInfo field',
          'TEE_INVALID_TCB_INFO',
        );
      }

      // Check issueDate freshness
      if (tcbInfo.issueDate) {
        const issueDate = new Date(tcbInfo.issueDate).getTime();
        const age = now - issueDate;

        if (age > MAX_COLLATERAL_AGE_MS) {
          const ageDays = Math.floor(age / (24 * 60 * 60 * 1000));
          const maxDays = Math.floor(MAX_COLLATERAL_AGE_MS / (24 * 60 * 60 * 1000));
          throw new AttestationError(
            `TCB info collateral is stale: issued ${ageDays} days ago, max allowed is ${maxDays} days`,
            'TEE_COLLATERAL_STALE',
          );
        }

        if (issueDate > now) {
          throw new AttestationError(
            `TCB info issueDate is in the future: ${tcbInfo.issueDate}`,
            'TEE_COLLATERAL_FUTURE_DATE',
          );
        }

        logger.info('collateral_freshness_issue_date_ok', {
          issueDate: tcbInfo.issueDate,
          ageMs: age,
        });
      } else {
        throw new AttestationError(
          'TCB info missing issueDate field',
          'TEE_COLLATERAL_NO_ISSUE_DATE',
        );
      }

      // Check nextUpdate is in the future
      if (tcbInfo.nextUpdate) {
        const nextUpdate = new Date(tcbInfo.nextUpdate).getTime();

        if (nextUpdate <= now) {
          throw new AttestationError(
            `TCB info collateral has expired: nextUpdate was ${tcbInfo.nextUpdate}`,
            'TEE_COLLATERAL_EXPIRED',
          );
        }

        logger.info('collateral_freshness_next_update_ok', {
          nextUpdate: tcbInfo.nextUpdate,
        });
      } else {
        throw new AttestationError(
          'TCB info missing nextUpdate field',
          'TEE_COLLATERAL_NO_NEXT_UPDATE',
        );
      }
    } catch (err) {
      if (err instanceof AttestationError) throw err;
      throw new AttestationError(
        `Failed to validate collateral freshness: ${(err as Error).message}`,
        'TEE_COLLATERAL_FRESHNESS_CHECK_FAILED',
      );
    }

    logger.info('collateral_freshness_validated');
  }

  // -------------------------------------------------------------------------
  // Internal: Evaluate TCB status from collateral
  //
  // Intel TCB levels define 16 SGX component SVN thresholds + a pceSvn
  // threshold. The quote's CPU SVN is a 16-byte value where each byte
  // is the platform's SVN for that component. For a TCB level to match,
  // ALL 16 component SVNs must be >= the level's thresholds, AND the
  // platform pceSvn must be >= the level's pceSvn. The first matching
  // level (levels are ordered highest-first by Intel) determines status.
  // -------------------------------------------------------------------------
  private async evaluateTCBStatus(
    collateral: PCCSCollateral,
    header: SGXQuoteHeader,
    reportBody: SGXReportBody,
  ): Promise<TCBStatus> {
    try {
      const tcbInfo = JSON.parse(collateral.tcbInfo);
      const tcbLevels = tcbInfo?.tcbInfo?.tcbLevels ?? [];

      // Parse the 16-byte CPU SVN from the quote's report body into
      // 16 individual component values for per-component comparison.
      const cpuSvnHex = reportBody.cpuSvn;
      if (cpuSvnHex.length !== 32) {
        throw new AttestationError(
          `Invalid CPU SVN length: expected 32 hex chars, got ${cpuSvnHex.length}`,
          'TEE_INVALID_CPU_SVN',
        );
      }
      const platformSvns: number[] = [];
      for (let i = 0; i < 16; i++) {
        platformSvns.push(parseInt(cpuSvnHex.substring(i * 2, i * 2 + 2), 16));
      }

      for (const level of tcbLevels) {
        const sgxComponents: Array<{ svn: number }> = level.tcb?.sgxtcbcomponents ?? [];
        const pcesvn: number = level.tcb?.pcesvn ?? 0;

        // Skip levels without the expected 16 components
        if (sgxComponents.length !== 16) continue;

        // Check pceSvn threshold
        if (header.pceSvn < pcesvn) continue;

        // Check ALL 16 SGX component SVN thresholds
        let allComponentsMet = true;
        for (let i = 0; i < 16; i++) {
          if (platformSvns[i] < (sgxComponents[i]?.svn ?? 0)) {
            allComponentsMet = false;
            break;
          }
        }

        if (allComponentsMet) {
          logger.info('tcb_level_matched', {
            status: level.tcbStatus,
            pceSvnRequired: pcesvn,
            pceSvnActual: header.pceSvn,
          });
          return level.tcbStatus as TCBStatus;
        }
      }

      logger.warn('tcb_no_matching_level', {
        platformSvns,
        pceSvn: header.pceSvn,
        levelsChecked: tcbLevels.length,
      });
      return TCBStatus.OUT_OF_DATE;
    } catch (error) {
      if (error instanceof AttestationError) throw error;
      logger.warn('tcb_evaluation_failed', { error: (error as Error).message });
      throw new AttestationError(
        `Failed to evaluate TCB status: ${(error as Error).message}`,
        'TEE_TCB_EVALUATION_FAILED',
      );
    }
  }

  private assertSupportedEnclaveType(enclaveType: TEEAttestationRequest['enclaveType']): void {
    if (enclaveType !== 'SGX') {
      throw new AttestationError(
        `Enclave type ${enclaveType} is not supported by the current verifier. ZeroID currently enforces Intel SGX DCAP verification only.`,
        'TEE_UNSUPPORTED_ENCLAVE_TYPE',
        400,
      );
    }
  }

  private assertCollateralProviderConfigured(): void {
    if (IS_PRODUCTION && !INTEL_PCS_API_KEY) {
      throw new AttestationError(
        'INTEL_PCS_API_KEY is required in production so TEE collateral can be fetched and verified from Intel PCS.',
        'TEE_PCS_AUTH_MISSING',
        503,
      );
    }
  }

  private enforceTCBPolicy(status: TCBStatus): void {
    if (!ALLOWED_TCB_STATUSES.has(status)) {
      throw new AttestationError(
        `TCB status ${status} is not allowed by policy. Allowed statuses: ${Array.from(ALLOWED_TCB_STATUSES).join(', ')}`,
        'TEE_TCB_STATUS_REJECTED',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Internal: Check MRSIGNER against allow-list
  // -------------------------------------------------------------------------
  private verifyMRSIGNERTrust(mrsigner: string): void {
    if (TRUSTED_MRSIGNERS.size === 0) {
      throw new AttestationError(
        'No trusted MRSIGNER values configured. Cannot verify enclave trust. ' +
        'Set TRUSTED_MRSIGNERS environment variable.',
        'TEE_NO_TRUST_ANCHORS',
      );
    }

    if (!TRUSTED_MRSIGNERS.has(mrsigner)) {
      throw new AttestationError(
        `MRSIGNER ${mrsigner} is not in the trusted set`,
        'TEE_UNTRUSTED_SIGNER',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Internal: Map TCB status to advisory IDs
  // -------------------------------------------------------------------------
  private getAdvisoryIds(status: TCBStatus): string[] {
    switch (status) {
      case TCBStatus.SW_HARDENING_NEEDED:
        return ['INTEL-SA-00334'];
      case TCBStatus.CONFIGURATION_NEEDED:
        return ['INTEL-SA-00219', 'INTEL-SA-00289'];
      case TCBStatus.CONFIGURATION_AND_SW_HARDENING_NEEDED:
        return ['INTEL-SA-00219', 'INTEL-SA-00289', 'INTEL-SA-00334'];
      case TCBStatus.OUT_OF_DATE:
        return ['INTEL-SA-00477'];
      default:
        return [];
    }
  }

  // -------------------------------------------------------------------------
  // Internal: Verify QE Report identity fields against authenticated
  // QE Identity collateral. This ensures the QE that generated the quote
  // matches Intel's signed enclave identity (MRSIGNER, isvProdId, etc.).
  // -------------------------------------------------------------------------
  private verifyQEReportIdentity(
    collateral: PCCSCollateral,
    certResult: QuoteCertificationResult,
  ): void {
    const qeId = JSON.parse(collateral.qeIdentity);
    const identity = qeId.enclaveIdentity;

    // Verify QE MRSIGNER matches the authenticated identity
    if (identity.mrsigner) {
      const expectedMrsigner = identity.mrsigner.toLowerCase();
      if (certResult.qeReportMrsigner !== expectedMrsigner) {
        throw new AttestationError(
          `QE Report MRSIGNER ${certResult.qeReportMrsigner} does not match authenticated QE Identity ${expectedMrsigner}`,
          'TEE_QE_MRSIGNER_MISMATCH',
        );
      }
    }

    // Verify QE isvProdId matches
    if (identity.isvprodid !== undefined) {
      if (certResult.qeReportIsvProdId !== identity.isvprodid) {
        throw new AttestationError(
          `QE Report isvProdId ${certResult.qeReportIsvProdId} does not match authenticated QE Identity ${identity.isvprodid}`,
          'TEE_QE_ISVPRODID_MISMATCH',
        );
      }
    }

    // Verify QE tcbLevels — the QE's isvSvn must meet at least one
    // non-revoked TCB level from the authenticated identity
    if (Array.isArray(identity.tcbLevels) && identity.tcbLevels.length > 0) {
      const matchingLevel = identity.tcbLevels.find(
        (level: { tcb?: { isvsvn?: number }; tcbStatus?: string }) =>
          level.tcb?.isvsvn !== undefined &&
          certResult.qeReportIsvSvn >= level.tcb.isvsvn &&
          level.tcbStatus !== 'Revoked',
      );

      if (!matchingLevel) {
        throw new AttestationError(
          `QE Report isvSvn ${certResult.qeReportIsvSvn} does not meet any non-revoked TCB level in authenticated QE Identity`,
          'TEE_QE_TCB_LEVEL_INSUFFICIENT',
        );
      }
    }

    logger.info('qe_report_identity_verified', {
      mrsigner: certResult.qeReportMrsigner,
      isvProdId: certResult.qeReportIsvProdId,
      isvSvn: certResult.qeReportIsvSvn,
    });
  }

  /**
   * Build a DER-encoded SPKI public key structure for an EC P-256 key.
   */
  private buildECPublicKeyDer(x: Buffer, y: Buffer): Buffer {
    // EC P-256 uncompressed point: 04 || x || y
    const point = Buffer.concat([Buffer.from([0x04]), x, y]);

    // SPKI wrapping for P-256
    const oidP256 = Buffer.from('06082a8648ce3d030107', 'hex');
    const oidEC = Buffer.from('06072a8648ce3d0201', 'hex');
    const algSeq = Buffer.concat([
      Buffer.from([0x30, oidEC.length + oidP256.length]),
      oidEC,
      oidP256,
    ]);
    const bitString = Buffer.concat([
      Buffer.from([0x03, point.length + 1, 0x00]),
      point,
    ]);
    const spki = Buffer.concat([
      Buffer.from([0x30, algSeq.length + bitString.length]),
      algSeq,
      bitString,
    ]);
    return spki;
  }

  /**
   * Convert raw r || s ECDSA signature to DER encoding.
   */
  private buildDERSignature(r: Buffer, s: Buffer): Buffer {
    const encodeInt = (val: Buffer): Buffer => {
      // Strip leading zeros but keep sign byte if needed
      let i = 0;
      while (i < val.length - 1 && val[i] === 0) i++;
      let trimmed = val.subarray(i);
      // Add leading zero if high bit is set (positive integer)
      if (trimmed[0] & 0x80) {
        trimmed = Buffer.concat([Buffer.from([0x00]), trimmed]);
      }
      return Buffer.concat([Buffer.from([0x02, trimmed.length]), trimmed]);
    };

    const rDer = encodeInt(r);
    const sDer = encodeInt(s);
    return Buffer.concat([
      Buffer.from([0x30, rDer.length + sDer.length]),
      rDer,
      sDer,
    ]);
  }

  // -------------------------------------------------------------------------
  // Internal: SHA-256 hex helper
  // -------------------------------------------------------------------------
  private sha256Hex(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------
export class AttestationError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, code: string, statusCode = 400) {
    super(message);
    this.name = 'AttestationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const teeService = new TEEAttestationService();
