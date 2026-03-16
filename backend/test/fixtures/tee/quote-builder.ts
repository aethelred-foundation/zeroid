/**
 * SGX DCAP Quote Builder with Real EC P-256 Cryptography
 *
 * Generates structurally valid SGX DCAP v3 quotes signed with real ECDSA keys.
 * Every signature in the produced quote is cryptographically valid — no mocks.
 *
 * Key hierarchy produced:
 *   Root CA (self-signed P-256) → Intermediate CA → PCK Leaf Cert
 *   PCK Leaf key signs the QE Report Body.
 *   Attestation Key (ephemeral P-256) signs the Quote Body (header + ISV report).
 *   QE Report reportData[0:32] = SHA-256(attestation_key_raw || qe_auth_data).
 */
import * as crypto from 'crypto';

// ─── Binary layout constants ─────────────────────────────────────────────────
const QUOTE_HEADER_SIZE = 48;
const REPORT_BODY_SIZE = 384;
const INTEL_QE_VENDOR = '939a7233f79c4ca9940a0db3957f0607';

// ─── Types ───────────────────────────────────────────────────────────────────
export interface KeyHierarchy {
  rootKey: crypto.KeyPairKeyObjectResult;
  rootCert: crypto.X509Certificate;
  rootCertPem: string;
  intermediateKey: crypto.KeyPairKeyObjectResult;
  intermediateCert: crypto.X509Certificate;
  intermediateCertPem: string;
  pckLeafKey: crypto.KeyPairKeyObjectResult;
  pckLeafCert: crypto.X509Certificate;
  pckLeafCertPem: string;
}

export interface QuoteComponents {
  quoteBuffer: Buffer;
  quoteBase64: string;
  attestKey: crypto.KeyPairKeyObjectResult;
  attestKeyRaw: Buffer;
  hierarchy: KeyHierarchy;
  qeAuthData: Buffer;
  mrenclave: string;
  mrsigner: string;
  cpuSvn: string;
  qeMrenclave: string;
  qeMrsigner: string;
  qeIsvProdId: number;
  qeIsvSvn: number;
  boundPublicKey: string;
  pceSvn: number;
  isvSvn: number;
  isvProdId: number;
}

export interface QuoteBuildOptions {
  version?: number;
  attestKeyType?: number;
  teeType?: number;
  qeSvn?: number;
  pceSvn?: number;
  qeVendorId?: string;
  cpuSvn?: string;
  mrenclave?: string;
  mrsigner?: string;
  isvProdId?: number;
  isvSvn?: number;
  qeMrenclave?: string;
  qeMrsigner?: string;
  qeIsvProdId?: number;
  qeIsvSvn?: number;
  qeAuthData?: Buffer;
  hierarchy?: KeyHierarchy;
  corruptIsvSignature?: boolean;
  corruptQeReportSignature?: boolean;
  corruptAttestKeyBinding?: boolean;
  attestKeyOverride?: crypto.KeyPairKeyObjectResult;
  certChainPemOverride?: string;
}

// ─── Generate an EC P-256 key pair synchronously ─────────────────────────────
export function generateP256KeyPair(): crypto.KeyPairKeyObjectResult {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
}

// ─── Extract raw public key coordinates (x, y) from a P-256 KeyObject ───────
export function extractRawPublicKey(pub: crypto.KeyObject): { x: Buffer; y: Buffer } {
  const spki = pub.export({ format: 'der', type: 'spki' }) as Buffer;
  const point = spki.subarray(-65);
  if (point[0] !== 0x04) throw new Error('Expected uncompressed point');
  return {
    x: Buffer.from(point.subarray(1, 33)),
    y: Buffer.from(point.subarray(33, 65)),
  };
}

// ─── Sign data with an EC P-256 private key, return raw r||s (64 bytes) ─────
export function signRaw(data: Buffer, privateKey: crypto.KeyObject): Buffer {
  const sig = crypto.sign('SHA256', data, privateKey);
  return derSignatureToRaw(sig);
}

// ─── Convert DER-encoded ECDSA signature to raw r||s (64 bytes) ─────────────
function derSignatureToRaw(derSig: Buffer): Buffer {
  let offset = 0;
  if (derSig[offset++] !== 0x30) throw new Error('Expected SEQUENCE');
  // skip outer length
  if (derSig[offset] & 0x80) {
    offset += 1 + (derSig[offset] & 0x7f);
  } else {
    offset += 1;
  }

  if (derSig[offset++] !== 0x02) throw new Error('Expected INTEGER for r');
  const rLen = derSig[offset++];
  let r = derSig.subarray(offset, offset + rLen);
  offset += rLen;
  if (r.length === 33 && r[0] === 0x00) r = r.subarray(1);

  if (derSig[offset++] !== 0x02) throw new Error('Expected INTEGER for s');
  const sLen = derSig[offset++];
  let s = derSig.subarray(offset, offset + sLen);
  if (s.length === 33 && s[0] === 0x00) s = s.subarray(1);

  const rPadded = Buffer.alloc(32);
  r.copy(rPadded, 32 - r.length);
  const sPadded = Buffer.alloc(32);
  s.copy(sPadded, 32 - s.length);

  return Buffer.concat([rPadded, sPadded]);
}

// ─── DER encoding helpers ───────────────────────────────────────────────────
function derLen(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x100) return Buffer.from([0x81, len]);
  return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
}

function derSeq(content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x30]), derLen(content.length), content]);
}

function derOctStr(content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x04]), derLen(content.length), content]);
}

function derInt(value: Buffer): Buffer {
  let v = value;
  if (v.length > 0 && (v[0] & 0x80)) {
    v = Buffer.concat([Buffer.from([0x00]), v]);
  }
  return Buffer.concat([Buffer.from([0x02]), derLen(v.length), v]);
}

function derExplicit(tag: number, content: Buffer): Buffer {
  const tagByte = 0xa0 | tag;
  return Buffer.concat([Buffer.from([tagByte]), derLen(content.length), content]);
}

function derBitStr(content: Buffer): Buffer {
  // BIT STRING: tag 03, length, unused-bits byte (0x00), content
  const inner = Buffer.concat([Buffer.from([0x00]), content]);
  return Buffer.concat([Buffer.from([0x03]), derLen(inner.length), inner]);
}

function derBool(val: boolean): Buffer {
  return Buffer.from([0x01, 0x01, val ? 0xff : 0x00]);
}

function encodeUTCTime(date: Date): Buffer {
  const y = date.getUTCFullYear() % 100;
  const str = [
    y.toString().padStart(2, '0'),
    (date.getUTCMonth() + 1).toString().padStart(2, '0'),
    date.getUTCDate().toString().padStart(2, '0'),
    date.getUTCHours().toString().padStart(2, '0'),
    date.getUTCMinutes().toString().padStart(2, '0'),
    date.getUTCSeconds().toString().padStart(2, '0'),
    'Z',
  ].join('');
  const buf = Buffer.from(str, 'ascii');
  return Buffer.concat([Buffer.from([0x17, buf.length]), buf]);
}

function buildRdnSequence(dn: string): Buffer {
  const match = dn.match(/CN=(.+)/);
  if (!match) throw new Error(`Cannot parse DN: ${dn}`);
  const cn = match[1];
  // OID 2.5.4.3 = commonName
  const cnOid = Buffer.from('0603550403', 'hex');
  const cnValue = Buffer.concat([
    Buffer.from([0x0c]), // UTF8String
    derLen(cn.length),
    Buffer.from(cn, 'utf8'),
  ]);
  const atv = derSeq(Buffer.concat([cnOid, cnValue]));
  // SET wrapping
  const rdn = Buffer.concat([Buffer.from([0x31]), derLen(atv.length), atv]);
  return derSeq(rdn);
}

// ─── Build an X.509 v3 certificate from DER primitives ──────────────────────
interface CertParams {
  subject: string;
  issuer: string;
  publicKey: crypto.KeyObject;
  signingKey: crypto.KeyObject;
  serialNumber: string;
  notBefore: Date;
  notAfter: Date;
  isCA: boolean;
}

function generateX509Cert(params: CertParams): string {
  // Version: v3 (value 2)
  const version = derExplicit(0, derInt(Buffer.from([0x02])));

  // Serial number
  const serialBytes = Buffer.from(params.serialNumber, 'hex');
  const serialNumber = derInt(serialBytes);

  // Signature Algorithm: ecdsa-with-SHA256 (1.2.840.10045.4.3.2)
  const sigAlgOid = Buffer.from('06082a8648ce3d040302', 'hex');
  const signatureAlgorithm = derSeq(sigAlgOid);

  const issuer = buildRdnSequence(params.issuer);
  const validity = derSeq(Buffer.concat([
    encodeUTCTime(params.notBefore),
    encodeUTCTime(params.notAfter),
  ]));
  const subject = buildRdnSequence(params.subject);

  // SubjectPublicKeyInfo
  const spki = params.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;

  // Extensions (v3)
  const extensions: Buffer[] = [];
  if (params.isCA) {
    // Extension: Basic Constraints (2.5.29.19), critical, CA:TRUE
    // SEQUENCE { OID, BOOLEAN TRUE (critical), OCTET STRING { SEQUENCE { BOOLEAN TRUE } } }
    const bcOid = Buffer.from('0603551d13', 'hex');
    const bcExtValue = derSeq(derBool(true)); // SEQUENCE { BOOLEAN TRUE }
    const ext = derSeq(Buffer.concat([bcOid, derBool(true), derOctStr(bcExtValue)]));
    extensions.push(ext);
  }

  let extensionsDer = Buffer.alloc(0);
  if (extensions.length > 0) {
    const allExts = derSeq(Buffer.concat(extensions));
    extensionsDer = derExplicit(3, allExts);
  }

  // tbsCertificate
  const tbsCertificate = derSeq(Buffer.concat([
    version,
    serialNumber,
    signatureAlgorithm,
    issuer,
    validity,
    subject,
    spki,
    extensionsDer,
  ]));

  // Sign
  const signature = crypto.sign('SHA256', tbsCertificate, params.signingKey);

  // Full certificate
  const cert = derSeq(Buffer.concat([
    tbsCertificate,
    signatureAlgorithm,
    derBitStr(signature),
  ]));

  // PEM encode
  const b64 = cert.toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) {
    lines.push(b64.substring(i, i + 64));
  }
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----`;
}

// ─── Generate a complete key hierarchy ──────────────────────────────────────
export function generateKeyHierarchy(_fmspc?: string): KeyHierarchy {
  const rootKey = generateP256KeyPair();
  const now = new Date();
  const rootCertPem = generateX509Cert({
    subject: 'CN=Test SGX Root CA',
    issuer: 'CN=Test SGX Root CA',
    publicKey: rootKey.publicKey,
    signingKey: rootKey.privateKey,
    serialNumber: crypto.randomBytes(16).toString('hex'),
    notBefore: now,
    notAfter: new Date(now.getTime() + 3650 * 86400000),
    isCA: true,
  });
  const rootCert = new crypto.X509Certificate(rootCertPem);

  const intermediateKey = generateP256KeyPair();
  const intermediateCertPem = generateX509Cert({
    subject: 'CN=Test SGX Intermediate CA',
    issuer: 'CN=Test SGX Root CA',
    publicKey: intermediateKey.publicKey,
    signingKey: rootKey.privateKey,
    serialNumber: crypto.randomBytes(16).toString('hex'),
    notBefore: now,
    notAfter: new Date(now.getTime() + 1825 * 86400000),
    isCA: true,
  });
  const intermediateCert = new crypto.X509Certificate(intermediateCertPem);

  const pckLeafKey = generateP256KeyPair();
  const pckLeafCertPem = generateX509Cert({
    subject: 'CN=Test SGX PCK Certificate',
    issuer: 'CN=Test SGX Intermediate CA',
    publicKey: pckLeafKey.publicKey,
    signingKey: intermediateKey.privateKey,
    serialNumber: crypto.randomBytes(16).toString('hex'),
    notBefore: now,
    notAfter: new Date(now.getTime() + 365 * 86400000),
    isCA: false,
  });
  const pckLeafCert = new crypto.X509Certificate(pckLeafCertPem);

  return {
    rootKey, rootCert, rootCertPem,
    intermediateKey, intermediateCert, intermediateCertPem,
    pckLeafKey, pckLeafCert, pckLeafCertPem,
  };
}

// ─── Build a cryptographically valid DCAP quote ─────────────────────────────
export function buildQuote(opts: QuoteBuildOptions = {}): QuoteComponents {
  const hierarchy = opts.hierarchy ?? generateKeyHierarchy();

  const mrenclave = opts.mrenclave ?? crypto.randomBytes(32).toString('hex');
  const mrsigner = opts.mrsigner ?? crypto.randomBytes(32).toString('hex');
  const cpuSvn = opts.cpuSvn ?? '0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a';
  const isvProdId = opts.isvProdId ?? 1;
  const isvSvn = opts.isvSvn ?? 2;
  const pceSvn = opts.pceSvn ?? 10;

  // Generate a random public key to bind into reportData
  const boundKeyPair = generateP256KeyPair();
  const boundPubDer = boundKeyPair.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const boundPublicKey = boundPubDer.toString('base64');
  const boundKeyHash = crypto.createHash('sha256').update(boundPubDer).digest('hex');

  // Build ISV Report Body (384 bytes)
  const isvReportBody = Buffer.alloc(REPORT_BODY_SIZE);
  Buffer.from(cpuSvn, 'hex').copy(isvReportBody, 0);
  Buffer.from(mrenclave, 'hex').copy(isvReportBody, 64);
  Buffer.from(mrsigner, 'hex').copy(isvReportBody, 128);
  isvReportBody.writeUInt16LE(isvProdId, 256);
  isvReportBody.writeUInt16LE(isvSvn, 258);
  Buffer.from(boundKeyHash, 'hex').copy(isvReportBody, 320);

  // Build Quote Header (48 bytes)
  const header = Buffer.alloc(QUOTE_HEADER_SIZE);
  header.writeUInt16LE(opts.version ?? 3, 0);
  header.writeUInt16LE(opts.attestKeyType ?? 2, 2);
  header.writeUInt32LE(opts.teeType ?? 0, 4);
  header.writeUInt16LE(opts.qeSvn ?? 6, 8);
  header.writeUInt16LE(pceSvn, 10);
  Buffer.from(opts.qeVendorId ?? INTEL_QE_VENDOR, 'hex').copy(header, 12);

  const quoteBody = Buffer.concat([header, isvReportBody]);

  // Generate attestation key pair
  const attestKey = opts.attestKeyOverride ?? generateP256KeyPair();
  const { x: attestX, y: attestY } = extractRawPublicKey(attestKey.publicKey);
  const attestKeyRaw = Buffer.concat([attestX, attestY]);

  // Sign quote body with attestation key
  let isvSignature = signRaw(quoteBody, attestKey.privateKey);
  if (opts.corruptIsvSignature) {
    isvSignature[0] ^= 0xff;
  }

  // QE auth data
  const qeAuthData = opts.qeAuthData ?? crypto.randomBytes(32);

  // QE Report Body
  const qeMrenclave = opts.qeMrenclave ?? crypto.randomBytes(32).toString('hex');
  const qeMrsigner = opts.qeMrsigner ?? crypto.randomBytes(32).toString('hex');
  const qeIsvProdId = opts.qeIsvProdId ?? 1;
  const qeIsvSvn = opts.qeIsvSvn ?? 6;

  const qeReportBody = Buffer.alloc(REPORT_BODY_SIZE);
  Buffer.from(qeMrenclave, 'hex').copy(qeReportBody, 64);
  Buffer.from(qeMrsigner, 'hex').copy(qeReportBody, 128);
  qeReportBody.writeUInt16LE(qeIsvProdId, 256);
  qeReportBody.writeUInt16LE(qeIsvSvn, 258);

  if (opts.corruptAttestKeyBinding) {
    crypto.randomBytes(32).copy(qeReportBody, 320);
  } else {
    const bindingHash = crypto.createHash('sha256')
      .update(attestKeyRaw)
      .update(qeAuthData)
      .digest();
    bindingHash.copy(qeReportBody, 320);
  }

  // Sign QE Report Body with PCK leaf key
  let qeSignature = signRaw(qeReportBody, hierarchy.pckLeafKey.privateKey);
  if (opts.corruptQeReportSignature) {
    qeSignature[0] ^= 0xff;
  }

  // Cert chain PEM
  const certChainPem = opts.certChainPemOverride ??
    `${hierarchy.pckLeafCertPem}\n${hierarchy.intermediateCertPem}\n`;
  const certChainBuf = Buffer.from(certChainPem, 'utf8');

  // Assemble the full quote
  const qeAuthLenBuf = Buffer.alloc(2);
  qeAuthLenBuf.writeUInt16LE(qeAuthData.length, 0);

  const certDataHeader = Buffer.alloc(6);
  certDataHeader.writeUInt16LE(5, 0);
  certDataHeader.writeUInt32LE(certChainBuf.length, 2);

  const quoteBuffer = Buffer.concat([
    quoteBody,
    isvSignature,
    attestKeyRaw,
    qeReportBody,
    qeSignature,
    qeAuthLenBuf,
    qeAuthData,
    certDataHeader,
    certChainBuf,
  ]);

  return {
    quoteBuffer,
    quoteBase64: quoteBuffer.toString('base64'),
    attestKey,
    attestKeyRaw,
    hierarchy,
    qeAuthData,
    mrenclave,
    mrsigner,
    cpuSvn,
    qeMrenclave,
    qeMrsigner,
    qeIsvProdId,
    qeIsvSvn,
    boundPublicKey,
    pceSvn,
    isvSvn,
    isvProdId,
  };
}

// ─── Build collateral with real signatures ──────────────────────────────────
export interface CollateralBuildOptions {
  hierarchy: KeyHierarchy;
  fmspc?: string;
  tcbLevels?: Array<{
    tcb: { sgxtcbcomponents: Array<{ svn: number }>; pcesvn: number };
    tcbStatus: string;
  }>;
  tcbIssueDate?: string;
  tcbNextUpdate?: string;
  qeMrsigner?: string;
  qeIsvProdId?: number;
  qeTcbLevels?: Array<{ tcb: { isvsvn: number }; tcbStatus: string }>;
  revokedSerials?: string[];
  crlThisUpdate?: Date;
  crlNextUpdate?: Date;
  tamperQeIdentity?: boolean;
  corruptQeIdentitySignature?: boolean;
  wrongQeIdentitySigningKey?: crypto.KeyPairKeyObjectResult;
}

export interface BuiltCollateral {
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

export function buildCollateral(opts: CollateralBuildOptions): BuiltCollateral {
  const { hierarchy } = opts;
  const fmspc = opts.fmspc ?? '00906ea10000';
  const now = new Date();

  // ── Build TCB Info ────────────────────────────────────────────────────
  const tcbIssueDate = opts.tcbIssueDate ?? now.toISOString();
  const tcbNextUpdate = opts.tcbNextUpdate ?? new Date(now.getTime() + 30 * 86400000).toISOString();

  const defaultTcbLevels = [
    {
      tcb: {
        sgxtcbcomponents: Array.from({ length: 16 }, () => ({ svn: 5 })),
        pcesvn: 10,
      },
      tcbStatus: 'UpToDate',
    },
    {
      tcb: {
        sgxtcbcomponents: Array.from({ length: 16 }, () => ({ svn: 2 })),
        pcesvn: 7,
      },
      tcbStatus: 'OutOfDate',
    },
  ];

  const tcbInfoBody = {
    tcbInfo: {
      fmspc,
      tcbLevels: opts.tcbLevels ?? defaultTcbLevels,
      issueDate: tcbIssueDate,
      nextUpdate: tcbNextUpdate,
    },
  };
  const tcbInfoJson = JSON.stringify(tcbInfoBody);

  // Sign TCB info with a dedicated signing key
  const tcbSigningKey = generateP256KeyPair();
  const tcbSigningCertPem = generateX509Cert({
    subject: 'CN=Test TCB Signing Cert',
    issuer: 'CN=Test SGX Intermediate CA',
    publicKey: tcbSigningKey.publicKey,
    signingKey: hierarchy.intermediateKey.privateKey,
    serialNumber: crypto.randomBytes(16).toString('hex'),
    notBefore: now,
    notAfter: new Date(now.getTime() + 365 * 86400000),
    isCA: false,
  });
  const tcbSigningCertChain = `${tcbSigningCertPem}\n${hierarchy.intermediateCertPem}\n`;

  const tcbInfoSigDer = crypto.sign('SHA256', Buffer.from(tcbInfoJson, 'utf8'), tcbSigningKey.privateKey);
  const tcbInfoSigRaw = derSignatureToRaw(tcbInfoSigDer);
  const tcbInfoSignature = tcbInfoSigRaw.toString('hex');

  // ── Build QE Identity ─────────────────────────────────────────────────
  const qeMrsigner = opts.qeMrsigner ?? crypto.randomBytes(32).toString('hex');
  const qeIsvProdId = opts.qeIsvProdId ?? 1;
  const qeTcbLevels = opts.qeTcbLevels ?? [
    { tcb: { isvsvn: 6 }, tcbStatus: 'UpToDate' },
    { tcb: { isvsvn: 2 }, tcbStatus: 'OutOfDate' },
  ];

  const qeIdentityBody = JSON.stringify({
    enclaveIdentity: {
      id: 'QE',
      mrsigner: qeMrsigner,
      isvprodid: qeIsvProdId,
      tcbLevels: qeTcbLevels,
    },
  });

  let qeIdentityFinal = qeIdentityBody;

  // Sign QE identity
  const qeIdSigningKey = opts.wrongQeIdentitySigningKey ?? generateP256KeyPair();
  const qeIdSigningCertPem = generateX509Cert({
    subject: 'CN=Test QE Identity Signing Cert',
    issuer: 'CN=Test SGX Intermediate CA',
    publicKey: qeIdSigningKey.publicKey,
    signingKey: hierarchy.intermediateKey.privateKey,
    serialNumber: crypto.randomBytes(16).toString('hex'),
    notBefore: now,
    notAfter: new Date(now.getTime() + 365 * 86400000),
    isCA: false,
  });
  const qeIdSigningCertChain = `${qeIdSigningCertPem}\n${hierarchy.intermediateCertPem}\n`;

  const signedQeData = qeIdentityBody; // always sign the original
  const qeIdSigDer = crypto.sign('SHA256', Buffer.from(signedQeData, 'utf8'), qeIdSigningKey.privateKey);
  let qeIdSigRaw = derSignatureToRaw(qeIdSigDer);

  if (opts.corruptQeIdentitySignature) {
    qeIdSigRaw = Buffer.from(qeIdSigRaw);
    qeIdSigRaw[0] ^= 0xff;
  }

  if (opts.tamperQeIdentity) {
    const parsed = JSON.parse(qeIdentityBody);
    parsed.enclaveIdentity.id = 'TAMPERED';
    qeIdentityFinal = JSON.stringify(parsed);
  }

  const qeIdentitySignature = qeIdSigRaw.toString('hex');

  // ── Build CRLs ────────────────────────────────────────────────────────
  const crlThisUpdate = opts.crlThisUpdate ?? new Date(now.getTime() - 3600000);
  const crlNextUpdate = opts.crlNextUpdate ?? new Date(now.getTime() + 30 * 86400000);

  const rootCaCrl = buildCRL(
    hierarchy.rootKey.privateKey,
    'Test SGX Root CA',
    [],
    crlThisUpdate,
    crlNextUpdate,
  );

  const pckCrl = buildCRL(
    hierarchy.intermediateKey.privateKey,
    'Test SGX Intermediate CA',
    opts.revokedSerials ?? [],
    crlThisUpdate,
    crlNextUpdate,
  );

  const pckCrlIssuerChain = `${hierarchy.intermediateCertPem}\n${hierarchy.rootCertPem}\n`;

  return {
    pckCrl: pckCrl.toString('hex'),
    pckCrlIssuerChain,
    rootCaCrl: rootCaCrl.toString('hex'),
    tcbInfo: tcbInfoJson,
    tcbInfoSignature,
    tcbSigningCertChain,
    qeIdentity: qeIdentityFinal,
    qeIdentitySignature,
    qeIdentitySigningCertChain: qeIdSigningCertChain,
  };
}

// ─── Build a minimal DER-encoded X.509 CRL ─────────────────────────────────
function buildCRL(
  signingKey: crypto.KeyObject,
  issuerCN: string,
  revokedSerials: string[],
  thisUpdate: Date,
  nextUpdate: Date,
): Buffer {
  const issuer = buildRdnSequence(`CN=${issuerCN}`);

  // Signature algorithm: ecdsa-with-SHA256
  const sigAlgOid = Buffer.from('06082a8648ce3d040302', 'hex');
  const signatureAlgorithm = derSeq(sigAlgOid);

  const thisUpdateDer = encodeUTCTime(thisUpdate);
  const nextUpdateDer = encodeUTCTime(nextUpdate);

  // Revoked certificates list
  let revokedCertsDer = Buffer.alloc(0);
  if (revokedSerials.length > 0) {
    const entries: Buffer[] = [];
    for (const serial of revokedSerials) {
      const serialInt = derInt(Buffer.from(serial, 'hex'));
      const revocationDate = encodeUTCTime(new Date());
      entries.push(derSeq(Buffer.concat([serialInt, revocationDate])));
    }
    revokedCertsDer = derSeq(Buffer.concat(entries));
  }

  // tbsCertList
  const tbsCertList = derSeq(Buffer.concat([
    signatureAlgorithm,
    issuer,
    thisUpdateDer,
    nextUpdateDer,
    revokedCertsDer,
  ]));

  // Sign
  const signature = crypto.sign('SHA256', tbsCertList, signingKey);

  return derSeq(Buffer.concat([
    tbsCertList,
    signatureAlgorithm,
    derBitStr(signature),
  ]));
}
