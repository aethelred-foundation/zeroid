/**
 * useAnalytics — Hook for privacy-preserving identity analytics.
 *
 * Provides tenant-local privacy calculations, credential usage analytics,
 * verifier insights, data exposure tracking, recommendations, and encrypted
 * report export from durable backend records.
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import {
  normalizeCredentialSummaries,
  type CredentialSummary,
} from "@/lib/credentials/summary";
import type { ISODateString, VerificationRequest } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrivacyScore {
  overallScore: number | null;
  grade: "A" | "B" | "C" | "D" | "F" | null;
  breakdown: PrivacyBreakdown;
  lastCalculatedAt: ISODateString;
  calculationBasis: string;
  recordCount: number;
}

export interface PrivacyBreakdown {
  selectiveDisclosureUsage: number;
  zkProofAdoption: number;
  credentialMinimisation: number;
  dataExposureControl: number;
  verifierDiversity: number;
  consentManagement: number;
}

export type AnalyticsPeriod = "7d" | "30d" | "90d" | "1y" | "all";

export interface CredentialUsageAnalytics {
  period: AnalyticsPeriod;
  totalPresentations: number;
  uniqueVerifiers: number;
  zkProofPresentations: number;
  selectiveDisclosurePresentations: number;
  fullDisclosurePresentations: number;
  privacyPreservingRatio: number;
  byCredentialType: CredentialTypeUsage[];
  byDay: DailyUsageStat[];
  topAttributes: AttributeUsage[];
}

export interface CredentialTypeUsage {
  credentialTypeLabel: string;
  credentialId: string;
  presentationCount: number;
  zkProofCount: number;
  selectiveDisclosureCount: number;
  lastUsedAt: ISODateString;
}

export interface DailyUsageStat {
  date: ISODateString;
  presentations: number;
  zkProofs: number;
  selectiveDisclosures: number;
}

export interface AttributeUsage {
  attributeKey: string;
  disclosureCount: number;
  proofOnlyCount: number;
  totalRequests: number;
  privacyRatio: number;
}

export interface VerifierAnalytics {
  totalVerifiers: number;
  verifiers: VerifierProfile[];
  requestsByPurpose: PurposeBreakdown[];
}

export interface VerifierProfile {
  verifierDid: string;
  verifierName: string;
  requestCount: number;
  lastRequestAt: ISODateString;
  attributesRequested: string[];
  zkProofRequestObserved: boolean;
}

export interface PurposeBreakdown {
  purpose: string;
  count: number;
  percentage: number;
}

export interface DataExposureTimeline {
  entries: ExposureEvent[];
  totalDisclosures: number;
  uniqueAttributesExposed: number;
  uniqueVerifiers: number;
  fullDisclosureEvents: number;
}

export interface ExposureEvent {
  id: string;
  timestamp: ISODateString;
  verifierDid: string;
  verifierName: string;
  credentialTypeLabel: string;
  attributesDisclosed: string[];
  disclosureMethod: "full" | "selective" | "zk_proof";
  purpose: string;
  consentRecorded: boolean;
}

export interface PrivacyRecommendation {
  id: string;
  priority: "critical" | "high" | "medium" | "low";
  category: string;
  title: string;
  description: string;
  currentBehavior: string;
  suggestedAction: string;
  implementationSteps: string[];
}

export interface AnalyticsExport {
  id: string;
  format: "json" | "csv" | "pdf";
  encryptionMethod: "none" | "aes-256-gcm" | "chacha20-poly1305";
  downloadUrl: string;
  generatedAt: ISODateString;
  expiresAt: ISODateString;
  sizeBytes: number;
  checksum: string;
}

// ---------------------------------------------------------------------------
// Query Keys
// ---------------------------------------------------------------------------

const analyticsKeys = {
  all: ["analytics"] as const,
  privacy: () => [...analyticsKeys.all, "privacy"] as const,
  credentialUsage: (p: AnalyticsPeriod) =>
    [...analyticsKeys.all, "credential-usage", p] as const,
  verifiers: () => [...analyticsKeys.all, "verifiers"] as const,
  exposure: () => [...analyticsKeys.all, "exposure"] as const,
  recommendations: () => [...analyticsKeys.all, "recommendations"] as const,
};

type VerificationResultState = "PENDING" | "VERIFIED" | "FAILED" | "EXPIRED";

type BackendVerificationHistoryEntry = {
  id: string;
  verificationType?: string;
  result?: VerificationResultState | string;
  requestedAt?: string | number | Date;
  completedAt?: string | number | Date | null;
  credentialId?: string | null;
  verifierId?: string | null;
  subjectId?: string | null;
};

type AnalyticsVerificationRequest = Partial<VerificationRequest> & {
  verifierDid?: string | { uri?: string };
  subjectDid?: string | { uri?: string };
  verifierName?: string;
  requestedAt?: string | number | Date;
  completedAt?: string | number | Date | null;
  requiredAttributes?: Array<string | { key?: string }>;
  requestedAttributes?: Array<string | { key?: string }>;
  requiredCredentials?: string[];
  credentialHash?: string;
  credentialId?: string;
  result?: VerificationResultState | string;
};

type AnalyticsSnapshot = {
  credentials: CredentialSummary[];
  history: DatedVerificationHistoryEntry[];
  requests: DatedVerificationRequest[];
  period: AnalyticsPeriod;
};

type DatedVerificationHistoryEntry = BackendVerificationHistoryEntry & {
  analyticsTimestamp: ISODateString;
};

type DatedVerificationRequest = AnalyticsVerificationRequest & {
  analyticsTimestamp: ISODateString;
};

const VERIFICATION_RESULTS: VerificationResultState[] = [
  "PENDING",
  "VERIFIED",
  "FAILED",
  "EXPIRED",
];

function periodStart(period: AnalyticsPeriod): Date | null {
  if (period === "all") return null;
  const daysByPeriod: Record<Exclude<AnalyticsPeriod, "all">, number> = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
    "1y": 365,
  };
  return new Date(Date.now() - daysByPeriod[period] * 24 * 60 * 60 * 1000);
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const parsed = new Date(value > 10_000_000_000 ? value : value * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function firstValidDate(...values: unknown[]): Date | null {
  for (const value of values) {
    const parsed = toDate(value);
    if (parsed) return parsed;
  }
  return null;
}

function inPeriod(value: Date, period: AnalyticsPeriod): boolean {
  const start = periodStart(period);
  return !start || value.getTime() >= start.getTime();
}

function verifierDid(value: AnalyticsVerificationRequest): string {
  if (typeof value.verifierDid === "string") return value.verifierDid;
  if (value.verifierDid?.uri) return value.verifierDid.uri;
  if (typeof value.verifierName === "string") return value.verifierName;
  return "unknown-verifier";
}

function credentialLabel(
  credential?: CredentialSummary,
  fallback = "credential",
): string {
  return credential?.typeLabel ?? fallback;
}

function credentialKey(credential?: CredentialSummary): string {
  return credential?.id ?? "unknown";
}

function requestAttributes(request: AnalyticsVerificationRequest): string[] {
  const values =
    request.requestedAttributes ?? request.requiredAttributes ?? [];
  return values
    .map((attribute) =>
      typeof attribute === "string" ? attribute : attribute.key,
    )
    .filter((attribute): attribute is string => Boolean(attribute));
}

function isZkRequest(
  item: AnalyticsVerificationRequest | BackendVerificationHistoryEntry,
): boolean {
  const type = "verificationType" in item ? item.verificationType : undefined;
  const circuitId = "circuitId" in item ? item.circuitId : undefined;
  return Boolean(
    type?.toUpperCase().includes("ZK") ||
    type?.toUpperCase().includes("ELIGIBILITY") ||
    circuitId,
  );
}

function disclosureMethod(
  request: AnalyticsVerificationRequest,
): ExposureEvent["disclosureMethod"] {
  if (isZkRequest(request)) return "zk_proof";
  const attributes = requestAttributes(request);
  return attributes.length > 0 && attributes.length <= 3 ? "selective" : "full";
}

function percentage(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function gradeForScore(score: number): PrivacyScore["grade"] {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function fetchVerificationRequests(): Promise<
  AnalyticsVerificationRequest[]
> {
  const groups = await Promise.all(
    VERIFICATION_RESULTS.map((result) =>
      apiClient.get<AnalyticsVerificationRequest[]>(
        `/api/v1/verification/requests?role=all&result=${result}&limit=100`,
      ),
    ),
  );
  return groups.flat();
}

async function fetchAnalyticsSnapshot(
  period: AnalyticsPeriod = "30d",
): Promise<AnalyticsSnapshot> {
  const [credentialResponse, history, requests] = await Promise.all([
    apiClient.get<unknown>("/api/v1/credentials?role=subject"),
    apiClient.get<BackendVerificationHistoryEntry[]>(
      "/api/v1/verification/history?limit=100",
    ),
    fetchVerificationRequests(),
  ]);

  return {
    credentials: normalizeCredentialSummaries(credentialResponse),
    history: history.flatMap((entry) => {
      const timestamp = firstValidDate(entry.requestedAt, entry.completedAt);
      return timestamp && inPeriod(timestamp, period)
        ? [{ ...entry, analyticsTimestamp: timestamp.toISOString() }]
        : [];
    }),
    requests: requests.flatMap((request) => {
      const timestamp = firstValidDate(
        request.requestedAt,
        request.createdAt,
        request.completedAt,
      );
      return timestamp && inPeriod(timestamp, period)
        ? [{ ...request, analyticsTimestamp: timestamp.toISOString() }]
        : [];
    }),
    period,
  };
}

function credentialMap(
  snapshot: AnalyticsSnapshot,
): Map<string, CredentialSummary> {
  const map = new Map<string, CredentialSummary>();
  for (const credential of snapshot.credentials) {
    map.set(credential.id, credential);
  }
  return map;
}

function buildUsage(snapshot: AnalyticsSnapshot): CredentialUsageAnalytics {
  const credentials = credentialMap(snapshot);
  const totalPresentations = snapshot.history.length;
  const zkProofPresentations = snapshot.history.filter(isZkRequest).length;
  const selectiveDisclosurePresentations = snapshot.requests.filter(
    (request) => disclosureMethod(request) === "selective",
  ).length;
  const fullDisclosurePresentations = snapshot.requests.filter(
    (request) => disclosureMethod(request) === "full",
  ).length;
  const verifierSet = new Set(
    snapshot.requests
      .map(verifierDid)
      .filter((verifier) => verifier !== "unknown-verifier"),
  );
  const byCredential = new Map<string, CredentialTypeUsage>();

  for (const entry of snapshot.history) {
    const credential = credentials.get(entry.credentialId ?? "");
    const key = credentialKey(credential);
    const current =
      byCredential.get(key) ??
      ({
        credentialTypeLabel: credentialLabel(
          credential,
          entry.credentialId ?? "credential",
        ),
        credentialId: key,
        presentationCount: 0,
        zkProofCount: 0,
        selectiveDisclosureCount: 0,
        lastUsedAt: entry.analyticsTimestamp,
      } satisfies CredentialTypeUsage);
    current.presentationCount += 1;
    if (isZkRequest(entry)) current.zkProofCount += 1;
    current.lastUsedAt = entry.analyticsTimestamp;
    byCredential.set(key, current);
  }

  for (const request of snapshot.requests) {
    const referencedId =
      request.credentialId ?? request.credentialHash ?? "unknown";
    const credential = credentials.get(referencedId);
    const key = credential?.id ?? referencedId;
    const current =
      byCredential.get(key) ??
      ({
        credentialTypeLabel: credentialLabel(credential, key),
        credentialId: key,
        presentationCount: 0,
        zkProofCount: 0,
        selectiveDisclosureCount: 0,
        lastUsedAt: request.analyticsTimestamp,
      } satisfies CredentialTypeUsage);
    if (disclosureMethod(request) === "selective") {
      current.selectiveDisclosureCount += 1;
    }
    byCredential.set(key, current);
  }

  const byDay = new Map<string, DailyUsageStat>();
  for (const entry of snapshot.history) {
    const date = entry.analyticsTimestamp.slice(0, 10);
    const current =
      byDay.get(date) ??
      ({
        date: new Date(`${date}T00:00:00.000Z`).toISOString(),
        presentations: 0,
        zkProofs: 0,
        selectiveDisclosures: 0,
      } satisfies DailyUsageStat);
    current.presentations += 1;
    if (isZkRequest(entry)) current.zkProofs += 1;
    byDay.set(date, current);
  }
  for (const request of snapshot.requests) {
    if (disclosureMethod(request) !== "selective") continue;
    const date = request.analyticsTimestamp.slice(0, 10);
    const current =
      byDay.get(date) ??
      ({
        date: new Date(`${date}T00:00:00.000Z`).toISOString(),
        presentations: 0,
        zkProofs: 0,
        selectiveDisclosures: 0,
      } satisfies DailyUsageStat);
    current.selectiveDisclosures += 1;
    byDay.set(date, current);
  }

  const attributeMap = new Map<string, AttributeUsage>();
  for (const request of snapshot.requests) {
    const method = disclosureMethod(request);
    for (const attribute of requestAttributes(request)) {
      const current =
        attributeMap.get(attribute) ??
        ({
          attributeKey: attribute,
          disclosureCount: 0,
          proofOnlyCount: 0,
          totalRequests: 0,
          privacyRatio: 0,
        } satisfies AttributeUsage);
      current.totalRequests += 1;
      if (method === "zk_proof") current.proofOnlyCount += 1;
      if (method !== "zk_proof") current.disclosureCount += 1;
      current.privacyRatio = percentage(
        current.proofOnlyCount,
        current.totalRequests,
      );
      attributeMap.set(attribute, current);
    }
  }

  return {
    period: snapshot.period,
    totalPresentations,
    uniqueVerifiers: verifierSet.size,
    zkProofPresentations,
    selectiveDisclosurePresentations,
    fullDisclosurePresentations,
    privacyPreservingRatio: percentage(
      snapshot.requests.filter(
        (request) => disclosureMethod(request) !== "full",
      ).length,
      snapshot.requests.length,
    ),
    byCredentialType: [...byCredential.values()].sort(
      (a, b) => b.presentationCount - a.presentationCount,
    ),
    byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    topAttributes: [...attributeMap.values()].sort(
      (a, b) => b.totalRequests - a.totalRequests,
    ),
  };
}

function buildPrivacyScore(snapshot: AnalyticsSnapshot): PrivacyScore {
  const usage = buildUsage(snapshot);
  const requests = snapshot.requests.length;
  const consented = snapshot.requests.filter(
    (request) => request.userConsent === true,
  ).length;
  const minimisedRequests = snapshot.requests.filter((request) => {
    const attributeCount = requestAttributes(request).length;
    return attributeCount > 0 && attributeCount <= 3;
  }).length;
  const exposureControlledRequests = snapshot.requests.filter(
    (request) => disclosureMethod(request) !== "full",
  ).length;
  const knownVerifierCount = new Set(
    snapshot.requests
      .map(verifierDid)
      .filter((verifier) => verifier !== "unknown-verifier"),
  ).size;
  const breakdown: PrivacyBreakdown = {
    selectiveDisclosureUsage: usage.privacyPreservingRatio,
    zkProofAdoption: percentage(
      snapshot.requests.filter(isZkRequest).length,
      requests,
    ),
    credentialMinimisation: percentage(minimisedRequests, requests),
    dataExposureControl: percentage(exposureControlledRequests, requests),
    verifierDiversity: percentage(knownVerifierCount, requests),
    consentManagement: percentage(consented, requests),
  };
  const overallScore =
    requests > 0 ? Math.round(average(Object.values(breakdown))) : null;

  return {
    overallScore,
    grade: overallScore === null ? null : gradeForScore(overallScore),
    breakdown,
    lastCalculatedAt: new Date().toISOString(),
    calculationBasis:
      "Calculated locally from the tenant's returned verification records; no network percentile or external benchmark is included.",
    recordCount: requests,
  };
}

function buildVerifierAnalytics(
  snapshot: AnalyticsSnapshot,
): VerifierAnalytics {
  const profiles = new Map<string, VerifierProfile>();
  const purposeCounts = new Map<string, number>();

  for (const request of snapshot.requests) {
    const verifier = verifierDid(request);
    if (verifier === "unknown-verifier") continue;
    const attributes = requestAttributes(request);
    const current =
      profiles.get(verifier) ??
      ({
        verifierDid: verifier,
        verifierName: request.verifierName ?? verifier,
        requestCount: 0,
        lastRequestAt: request.analyticsTimestamp,
        attributesRequested: [],
        zkProofRequestObserved: false,
      } satisfies VerifierProfile);
    current.requestCount += 1;
    current.lastRequestAt = request.analyticsTimestamp;
    current.attributesRequested = [
      ...new Set([...current.attributesRequested, ...attributes]),
    ];
    current.zkProofRequestObserved =
      current.zkProofRequestObserved || isZkRequest(request);
    profiles.set(verifier, current);

    const purpose = request.purpose ?? "unspecified";
    purposeCounts.set(purpose, (purposeCounts.get(purpose) ?? 0) + 1);
  }

  const verifiers = [...profiles.values()].sort(
    (a, b) => b.requestCount - a.requestCount,
  );
  const totalRequests = Math.max(1, snapshot.requests.length);
  return {
    totalVerifiers: verifiers.length,
    verifiers,
    requestsByPurpose: [...purposeCounts.entries()]
      .map(([purpose, count]) => ({
        purpose,
        count,
        percentage: percentage(count, totalRequests),
      }))
      .sort((a, b) => b.count - a.count),
  };
}

function buildExposureTimeline(
  snapshot: AnalyticsSnapshot,
): DataExposureTimeline {
  const credentials = credentialMap(snapshot);
  const entries = snapshot.requests.map<ExposureEvent>((request) => {
    const attributes = requestAttributes(request);
    const method = disclosureMethod(request);
    const referencedCredentialId =
      request.credentialId ?? request.credentialHash;
    const credential = referencedCredentialId
      ? credentials.get(referencedCredentialId)
      : undefined;
    return {
      id: request.id ?? `${verifierDid(request)}-${request.analyticsTimestamp}`,
      timestamp: request.analyticsTimestamp,
      verifierDid: verifierDid(request),
      verifierName: request.verifierName ?? verifierDid(request),
      credentialTypeLabel:
        credential?.typeLabel ??
        request.requiredCredentials?.[0] ??
        referencedCredentialId ??
        "credential",
      attributesDisclosed: method === "zk_proof" ? [] : attributes,
      disclosureMethod: method,
      purpose: request.purpose ?? "unspecified",
      consentRecorded: request.userConsent === true,
    };
  });
  const uniqueAttributes = new Set(
    entries.flatMap((entry) => entry.attributesDisclosed),
  );
  const uniqueVerifiers = new Set(
    entries
      .map((entry) => entry.verifierDid)
      .filter((verifier) => verifier !== "unknown-verifier"),
  );
  const fullDisclosureEvents = entries.filter(
    (entry) => entry.disclosureMethod === "full",
  ).length;

  return {
    entries: entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    totalDisclosures: entries.reduce(
      (sum, entry) => sum + entry.attributesDisclosed.length,
      0,
    ),
    uniqueAttributesExposed: uniqueAttributes.size,
    uniqueVerifiers: uniqueVerifiers.size,
    fullDisclosureEvents,
  };
}

function buildRecommendations(
  snapshot: AnalyticsSnapshot,
): PrivacyRecommendation[] {
  const score = buildPrivacyScore(snapshot);
  const usage = buildUsage(snapshot);
  const recommendations: PrivacyRecommendation[] = [];

  if (score.recordCount === 0) return recommendations;

  if (usage.fullDisclosurePresentations > 0) {
    recommendations.push({
      id: "reduce-full-disclosure",
      priority: "high",
      category: "data_minimisation",
      title: "Replace full disclosures with selective proofs",
      description:
        "Some returned request shapes contain neither a ZK circuit nor a limited attribute set, so this local calculation classifies them as full disclosure.",
      currentBehavior: `${usage.fullDisclosurePresentations} inferred full-disclosure request(s) in this period`,
      suggestedAction:
        "Use selective disclosure or ZK circuits for verifier workflows that only need eligibility facts.",
      implementationSteps: [
        "Review requests with disclosureMethod=full",
        "Map each verifier purpose to minimum required attributes",
        "Offer a ZK proof template where possible",
      ],
    });
  }

  if (score.breakdown.consentManagement < 80) {
    recommendations.push({
      id: "strengthen-consent-recording",
      priority: "medium",
      category: "consent",
      title: "Improve consent evidence capture",
      description:
        "Some verifier interactions do not carry explicit consent evidence.",
      currentBehavior: `${score.breakdown.consentManagement}% consent coverage`,
      suggestedAction:
        "Attach consent receipts to verifier request approvals and disclosure responses.",
      implementationSteps: [
        "Require consent flag before responding to verifier requests",
        "Persist consent receipt IDs in disclosure history",
        "Surface missing consent records in audit review",
      ],
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      id: "maintain-privacy-posture",
      priority: "low",
      category: "operations",
      title: "Maintain current privacy posture",
      description:
        "No urgent privacy analytics gaps were detected in the selected period.",
      currentBehavior: `Calculated privacy score ${score.overallScore}/100`,
      suggestedAction:
        "Continue periodic review of verifier requests and disclosure patterns.",
      implementationSteps: [
        "Review analytics weekly",
        "Refresh stale credentials before expiry",
        "Keep verifier allowlists current",
      ],
    });
  }

  return recommendations.sort(
    (a, b) =>
      ({ critical: 0, high: 1, medium: 2, low: 3 })[a.priority] -
      { critical: 0, high: 1, medium: 2, low: 3 }[b.priority],
  );
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function analyticsReportCsv(report: Record<string, unknown>): string {
  const usage = report.credentialUsage as CredentialUsageAnalytics;
  return [
    "metric,value",
    `privacyScore,${csvCell((report.privacyScore as PrivacyScore).overallScore)}`,
    `totalPresentations,${csvCell(usage.totalPresentations)}`,
    `uniqueVerifiers,${csvCell(usage.uniqueVerifiers)}`,
    `privacyPreservingRatio,${csvCell(usage.privacyPreservingRatio)}`,
    `recommendations,${csvCell((report.recommendations as PrivacyRecommendation[]).length)}`,
  ].join("\n");
}

function escapePdfText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function analyticsReportPdf(report: Record<string, unknown>): string {
  const privacyScore = report.privacyScore as PrivacyScore;
  const usage = report.credentialUsage as CredentialUsageAnalytics;
  const scoreSummary =
    privacyScore.overallScore === null
      ? "Unavailable (no dated verification requests)"
      : `${privacyScore.overallScore}/100 (${privacyScore.grade})`;
  const lines = [
    "ZeroID Analytics Report",
    `Calculated tenant privacy score: ${scoreSummary}`,
    `Presentations: ${usage.totalPresentations}`,
    `Unique verifiers: ${usage.uniqueVerifiers}`,
    `Privacy preserving ratio: ${usage.privacyPreservingRatio}%`,
  ];
  const text = lines
    .map(
      (line, index) =>
        `BT /F1 12 Tf 72 ${740 - index * 22} Td (${escapePdfText(line)}) Tj ET`,
    )
    .join("\n");
  const stream = `${text}\n`;
  return `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj
4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
5 0 obj << /Length ${stream.length} >> stream
${stream}endstream endobj
trailer << /Root 1 0 R >>
%%EOF`;
}

function fnvChecksum(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

async function maybeEncryptPayload(
  payload: string,
  encryptionKey?: string,
): Promise<{ payload: string; method: AnalyticsExport["encryptionMethod"] }> {
  if (!encryptionKey) {
    return { payload, method: "none" };
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error("Browser Web Crypto is required for encrypted exports");
  }

  const encoder = new TextEncoder();
  const keyMaterial = await globalThis.crypto.subtle.digest(
    "SHA-256",
    encoder.encode(encryptionKey),
  );
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(payload),
  );

  return {
    method: "aes-256-gcm",
    payload: JSON.stringify({
      version: "zeroid.analytics.export.encrypted.v1",
      algorithm: "AES-GCM",
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    }),
  };
}

function downloadReport(
  payload: string,
  format: AnalyticsExport["format"],
  encrypted: boolean,
): { url: string; sizeBytes: number; checksum: string } {
  const mimeType = encrypted
    ? "application/octet-stream"
    : format === "json"
      ? "application/json"
      : format === "csv"
        ? "text/csv"
        : "application/pdf";
  const blob = new Blob([payload], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `zeroid-analytics-${Date.now()}.${
    encrypted ? "enc" : format
  }`;
  link.click();
  return {
    url,
    sizeBytes: blob.size,
    checksum: fnvChecksum(payload),
  };
}

// ---------------------------------------------------------------------------
// Privacy Score
// ---------------------------------------------------------------------------

export function usePrivacyScore(period: AnalyticsPeriod = "30d") {
  const { address } = useAccount();

  return useQuery({
    queryKey: [...analyticsKeys.privacy(), period],
    queryFn: async () =>
      buildPrivacyScore(await fetchAnalyticsSnapshot(period)),
    enabled: !!address,
    staleTime: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Credential Usage
// ---------------------------------------------------------------------------

export function useCredentialUsageAnalytics(period: AnalyticsPeriod = "30d") {
  const { address } = useAccount();

  return useQuery({
    queryKey: analyticsKeys.credentialUsage(period),
    queryFn: async () => buildUsage(await fetchAnalyticsSnapshot(period)),
    enabled: !!address,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Verifier Analytics
// ---------------------------------------------------------------------------

export function useVerifierAnalytics(period: AnalyticsPeriod = "90d") {
  const { address } = useAccount();

  return useQuery({
    queryKey: [...analyticsKeys.verifiers(), period],
    queryFn: async () =>
      buildVerifierAnalytics(await fetchAnalyticsSnapshot(period)),
    enabled: !!address,
    staleTime: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Data Exposure Timeline
// ---------------------------------------------------------------------------

export function useDataExposureTimeline(period: AnalyticsPeriod = "90d") {
  const { address } = useAccount();

  return useQuery({
    queryKey: [...analyticsKeys.exposure(), period],
    queryFn: async () =>
      buildExposureTimeline(await fetchAnalyticsSnapshot(period)),
    enabled: !!address,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Privacy Recommendations
// ---------------------------------------------------------------------------

export function usePrivacyRecommendations(period: AnalyticsPeriod = "30d") {
  const { address } = useAccount();

  return useQuery({
    queryKey: [...analyticsKeys.recommendations(), period],
    queryFn: async () =>
      buildRecommendations(await fetchAnalyticsSnapshot(period)),
    enabled: !!address,
    staleTime: 300_000,
  });
}

// ---------------------------------------------------------------------------
// Export Analytics Report
// ---------------------------------------------------------------------------

export function useExportAnalyticsReport() {
  return useMutation({
    mutationFn: async (params: {
      format: "json" | "csv" | "pdf";
      period?: AnalyticsPeriod;
      sections?: string[];
      encryptionKey?: string;
    }): Promise<AnalyticsExport> => {
      const snapshot = await fetchAnalyticsSnapshot(params.period ?? "30d");
      const report = {
        generatedAt: new Date().toISOString(),
        period: snapshot.period,
        sections: params.sections ?? [
          "privacyScore",
          "credentialUsage",
          "verifiers",
          "exposure",
          "recommendations",
        ],
        privacyScore: buildPrivacyScore(snapshot),
        credentialUsage: buildUsage(snapshot),
        verifiers: buildVerifierAnalytics(snapshot),
        exposure: buildExposureTimeline(snapshot),
        recommendations: buildRecommendations(snapshot),
      };
      const payload =
        params.format === "json"
          ? JSON.stringify(report, null, 2)
          : params.format === "csv"
            ? analyticsReportCsv(report)
            : analyticsReportPdf(report);
      const exportPayload = await maybeEncryptPayload(
        payload,
        params.encryptionKey,
      );
      const downloaded = downloadReport(
        exportPayload.payload,
        params.format,
        exportPayload.method !== "none",
      );
      const generatedAt = new Date();

      return {
        id: `analytics-${generatedAt.getTime()}`,
        format: params.format,
        encryptionMethod: exportPayload.method,
        downloadUrl: downloaded.url,
        generatedAt: generatedAt.toISOString(),
        expiresAt: new Date(
          generatedAt.getTime() + 15 * 60 * 1000,
        ).toISOString(),
        sizeBytes: downloaded.sizeBytes,
        checksum: downloaded.checksum,
      };
    },
    onSuccess: (data) => {
      const encryptionDescription =
        data.encryptionMethod === "none"
          ? "not encrypted"
          : `encrypted with ${data.encryptionMethod}`;
      toast.success("Analytics report exported", {
        description: `${data.format.toUpperCase()} report (${(
          data.sizeBytes / 1024
        ).toFixed(1)} KB) — ${encryptionDescription}`,
      });
    },
    onError: (err: Error) => {
      toast.error("Export failed", { description: err.message });
    },
  });
}
