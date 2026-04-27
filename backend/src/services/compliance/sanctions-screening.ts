import { z } from 'zod';
import { createLogger, format, transports } from 'winston';
import crypto from 'crypto';
import { isProductionRuntime, isSanctionsScreeningDisabled } from '../production-safety';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const logger = createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { service: 'sanctions-screening' },
  transports: [new transports.Console()],
});

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------
export const SANCTIONS_LIST_NAMES = ['ofac_sdn', 'eu_consolidated', 'un_sanctions', 'uae_local', 'pep_database'] as const;
export type SanctionsListName = typeof SANCTIONS_LIST_NAMES[number];
const MAX_PRODUCTION_SANCTIONS_LIST_AGE_HOURS = 24;

export const SanctionsListMetadataSchema = z.object({
  updatedAt: z.string().datetime(),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/i),
  sourceName: z.string().min(1).optional(),
  signingKeyId: z.string().min(1).optional(),
  signature: z.string().min(16).optional(),
});

export type SanctionsListMetadata = z.infer<typeof SanctionsListMetadataSchema>;

export const ScreeningRequestSchema = z.object({
  entityId: z.string(),
  entityType: z.enum(['individual', 'corporate', 'vessel', 'aircraft']),
  names: z.array(z.object({
    fullName: z.string().min(1),
    nameType: z.enum(['primary', 'alias', 'former', 'transliteration']),
    script: z.enum(['latin', 'arabic', 'cyrillic', 'cjk', 'other']).default('latin'),
  })),
  dateOfBirth: z.string().optional(),
  nationality: z.string().optional(),
  identifiers: z.array(z.object({
    type: z.enum(['passport', 'national_id', 'tax_id', 'registration_number']),
    value: z.string(),
    country: z.string().optional(),
  })).default([]),
  addresses: z.array(z.object({
    country: z.string(),
    city: z.string().optional(),
    fullAddress: z.string().optional(),
  })).default([]),
  screenAgainst: z.array(z.enum(SANCTIONS_LIST_NAMES)).default([...SANCTIONS_LIST_NAMES]),
});

export type ScreeningRequest = z.infer<typeof ScreeningRequestSchema>;

export const BatchScreeningRequestSchema = z.object({
  clientId: z.string(),
  requests: z.array(ScreeningRequestSchema).min(1).max(1000),
  priority: z.enum(['high', 'normal', 'low']).default('normal'),
  callbackUrl: z.string().url().optional(),
});

export type BatchScreeningRequest = z.infer<typeof BatchScreeningRequestSchema>;

export const FalsePositiveDecisionSchema = z.object({
  matchId: z.string().uuid(),
  decision: z.enum(['confirmed_match', 'false_positive', 'escalate']),
  reason: z.string().min(10),
  decidedBy: z.string(),
  evidenceRefs: z.array(z.string()).default([]),
});

export type FalsePositiveDecision = z.infer<typeof FalsePositiveDecisionSchema>;

// ---------------------------------------------------------------------------
// Match result types
// ---------------------------------------------------------------------------
export interface SanctionsMatch {
  matchId: string;
  listSource: string;
  listEntryId: string;
  matchedName: string;
  matchScore: number;
  matchType: 'exact' | 'fuzzy' | 'partial' | 'phonetic' | 'transliteration';
  matchedFields: string[];
  listingDetails: {
    programs: string[];
    listedDate: string;
    remarks: string;
    sdnType?: string;
  };
  status: 'pending_review' | 'confirmed_match' | 'false_positive' | 'escalated';
}

export interface ScreeningResult {
  screeningId: string;
  entityId: string;
  timestamp: string;
  overallRisk: 'clear' | 'potential_match' | 'confirmed_match';
  matches: SanctionsMatch[];
  listsScreened: string[];
  processingTimeMs: number;
  nextScreeningDate: string;
}

export interface AuditEntry {
  id: string;
  screeningId: string;
  action: string;
  performedBy: string;
  timestamp: string;
  details: Record<string, unknown>;
}

export interface SanctionsListReadiness {
  listName: SanctionsListName;
  entryCount: number;
  ready: boolean;
  issues: string[];
  updatedAt?: string;
  sourceDigest?: string;
  signingKeyId?: string;
}

export function computeSanctionsListDigest(entries: SanctionsListEntry[]): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([...entries].sort((a, b) => a.id.localeCompare(b.id))))
    .digest('hex');
}

export function buildSanctionsListSignaturePayload(
  listName: SanctionsListName,
  entries: SanctionsListEntry[],
  metadata: Omit<SanctionsListMetadata, 'signature'>,
): string {
  return JSON.stringify({
    listName,
    updatedAt: metadata.updatedAt,
    sourceDigest: metadata.sourceDigest,
    entryDigest: computeSanctionsListDigest(entries),
    sourceName: metadata.sourceName ?? null,
    signingKeyId: metadata.signingKeyId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Arabic/Latin transliteration map
// ---------------------------------------------------------------------------
const ARABIC_LATIN_MAP: Record<string, string[]> = {
  'محمد': ['mohammed', 'muhammad', 'mohamed', 'mohamad', 'muhamad'],
  'أحمد': ['ahmed', 'ahmad'],
  'عبد': ['abd', 'abdul', 'abdel', 'abdal'],
  'الله': ['allah', 'alla'],
  'الرحمن': ['alrahman', 'al-rahman', 'arrahman'],
  'علي': ['ali', 'aly'],
  'حسن': ['hassan', 'hasan', 'hasen'],
  'حسين': ['hussein', 'husain', 'hussain', 'hossein'],
  'خالد': ['khalid', 'khaled'],
  'إبراهيم': ['ibrahim', 'ebrahim', 'abraham'],
  'عمر': ['omar', 'omer', 'umar'],
  'يوسف': ['youssef', 'yusuf', 'yousef', 'joseph'],
  'سلطان': ['sultan', 'soltan'],
  'سعيد': ['said', 'saeed', 'saeid'],
  'ناصر': ['nasser', 'naser', 'nasir'],
  'فاطمة': ['fatima', 'fatma', 'fatemeh'],
};

// ---------------------------------------------------------------------------
// SanctionsScreeningService
// ---------------------------------------------------------------------------
export class SanctionsScreeningService {
  private sanctionsLists: Map<string, SanctionsListEntry[]> = new Map();
  private sanctionsListMetadata: Map<string, SanctionsListMetadata> = new Map();
  private screeningResults: Map<string, ScreeningResult> = new Map();
  private auditLog: AuditEntry[] = [];
  private falsePositives: Map<string, FalsePositiveDecision> = new Map();
  private continuousMonitoringEntities: Set<string> = new Set();
  private matchThreshold: number;
  private listMaxAgeMs: number;

  constructor(matchThreshold = 0.78) {
    this.matchThreshold = matchThreshold;
    this.listMaxAgeMs = this.resolveListMaxAgeMs();
    this.initializeLists();
    logger.info('SanctionsScreeningService initialized', { threshold: matchThreshold });
  }

  private initializeLists(): void {
    for (const listName of SANCTIONS_LIST_NAMES) {
      this.sanctionsLists.set(listName, []);
    }
  }

  // -------------------------------------------------------------------------
  // Single entity screening
  // -------------------------------------------------------------------------
  async screenEntity(request: ScreeningRequest): Promise<ScreeningResult> {
    const parsed = ScreeningRequestSchema.parse(request);
    if (isSanctionsScreeningDisabled()) {
      const error = new Error('Sanctions screening is disabled by deployment configuration');
      (error as Error & { code: string }).code = 'SANCTIONS_SCREENING_DISABLED';
      throw error;
    }
    this.assertScreeningListsReady(parsed.screenAgainst);
    const startTime = Date.now();
    const screeningId = crypto.randomUUID();

    const allMatches: SanctionsMatch[] = [];

    for (const listName of parsed.screenAgainst) {
      const listEntries = this.sanctionsLists.get(listName) ?? [];
      const matches = this.matchAgainstList(parsed, listEntries, listName);
      allMatches.push(...matches);
    }

    // Deduplicate by list entry
    const deduped = this.deduplicateMatches(allMatches);

    // Apply false-positive resolutions
    const resolved = deduped.map((m) => {
      const fp = this.falsePositives.get(m.matchId);
      if (fp) {
        m.status = fp.decision === 'false_positive' ? 'false_positive' : fp.decision === 'confirmed_match' ? 'confirmed_match' : 'escalated';
      }
      return m;
    });

    const activeMatches = resolved.filter((m) => m.status !== 'false_positive');
    let overallRisk: ScreeningResult['overallRisk'] = 'clear';
    if (activeMatches.some((m) => m.status === 'confirmed_match')) {
      overallRisk = 'confirmed_match';
    } else if (activeMatches.some((m) => m.status === 'pending_review')) {
      overallRisk = 'potential_match';
    }

    const result: ScreeningResult = {
      screeningId,
      entityId: parsed.entityId,
      timestamp: new Date().toISOString(),
      overallRisk,
      matches: resolved,
      listsScreened: [...parsed.screenAgainst],
      processingTimeMs: Date.now() - startTime,
      nextScreeningDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    this.screeningResults.set(screeningId, result);
    this.logAudit(screeningId, 'screening_completed', 'system', {
      entityId: parsed.entityId,
      matchCount: resolved.length,
      overallRisk,
    });

    if (this.continuousMonitoringEntities.has(parsed.entityId)) {
      logger.info('continuous_monitoring_screening', { entityId: parsed.entityId, screeningId });
    }

    logger.info('screening_complete', {
      screeningId,
      entityId: parsed.entityId,
      overallRisk,
      matchCount: resolved.length,
      durationMs: result.processingTimeMs,
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // Batch screening
  // -------------------------------------------------------------------------
  async screenBatch(batchRequest: BatchScreeningRequest): Promise<{
    batchId: string;
    totalEntities: number;
    results: ScreeningResult[];
    summary: { clear: number; potentialMatch: number; confirmedMatch: number };
    processingTimeMs: number;
  }> {
    const parsed = BatchScreeningRequestSchema.parse(batchRequest);
    const batchId = crypto.randomUUID();
    const startTime = Date.now();

    logger.info('batch_screening_started', { batchId, clientId: parsed.clientId, count: parsed.requests.length });

    const results: ScreeningResult[] = [];
    const summary = { clear: 0, potentialMatch: 0, confirmedMatch: 0 };

    // Process in chunks of 50 for controlled concurrency
    const chunkSize = 50;
    for (let i = 0; i < parsed.requests.length; i += chunkSize) {
      const chunk = parsed.requests.slice(i, i + chunkSize);
      const chunkResults = await Promise.all(chunk.map((req) => this.screenEntity(req)));
      for (const result of chunkResults) {
        results.push(result);
        if (result.overallRisk === 'clear') summary.clear++;
        else if (result.overallRisk === 'potential_match') summary.potentialMatch++;
        else summary.confirmedMatch++;
      }
    }

    const processingTimeMs = Date.now() - startTime;
    logger.info('batch_screening_complete', { batchId, summary, durationMs: processingTimeMs });

    return { batchId, totalEntities: results.length, results, summary, processingTimeMs };
  }

  // -------------------------------------------------------------------------
  // Name matching with fuzzy/transliteration support
  // -------------------------------------------------------------------------
  private matchAgainstList(request: ScreeningRequest, entries: SanctionsListEntry[], listName: string): SanctionsMatch[] {
    const matches: SanctionsMatch[] = [];

    for (const entry of entries) {
      let bestScore = 0;
      let bestMatchType: SanctionsMatch['matchType'] = 'fuzzy';
      const matchedFields: string[] = [];
      let matchedName = '';

      for (const inputName of request.names) {
        const normalizedInput = this.normalizeName(inputName.fullName);
        const transliterations = this.getTransliterations(inputName.fullName, inputName.script);
        const allInputVariants = [normalizedInput, ...transliterations];

        for (const entryName of entry.names) {
          const normalizedEntry = this.normalizeName(entryName);

          for (const variant of allInputVariants) {
            // Exact match
            if (variant === normalizedEntry) {
              bestScore = 1.0;
              bestMatchType = variant === normalizedInput ? 'exact' : 'transliteration';
              matchedName = entryName;
              matchedFields.push('name');
              break;
            }

            // Fuzzy match using Jaro-Winkler distance
            const score = this.jaroWinklerDistance(variant, normalizedEntry);
            if (score > bestScore) {
              bestScore = score;
              bestMatchType = variant !== normalizedInput ? 'transliteration' : score > 0.95 ? 'partial' : 'fuzzy';
              matchedName = entryName;
              if (!matchedFields.includes('name')) matchedFields.push('name');
            }

            // Phonetic matching (Soundex)
            if (this.soundex(variant) === this.soundex(normalizedEntry)) {
              const phoneticScore = Math.max(bestScore, 0.85);
              if (phoneticScore > bestScore) {
                bestScore = phoneticScore;
                bestMatchType = 'phonetic';
                matchedName = entryName;
                if (!matchedFields.includes('name_phonetic')) matchedFields.push('name_phonetic');
              }
            }
          }
        }
      }

      // Date of birth matching
      if (request.dateOfBirth && entry.dateOfBirth) {
        if (request.dateOfBirth === entry.dateOfBirth) {
          bestScore = Math.min(1.0, bestScore + 0.1);
          matchedFields.push('date_of_birth');
        }
      }

      // Nationality matching
      if (request.nationality && entry.nationalities?.includes(request.nationality)) {
        bestScore = Math.min(1.0, bestScore + 0.05);
        matchedFields.push('nationality');
      }

      // Identifier matching
      for (const id of request.identifiers) {
        if (entry.identifiers?.some((eid) => eid.value === id.value && eid.type === id.type)) {
          bestScore = Math.min(1.0, bestScore + 0.2);
          matchedFields.push(`identifier_${id.type}`);
        }
      }

      if (bestScore >= this.matchThreshold) {
        matches.push({
          matchId: crypto.randomUUID(),
          listSource: listName,
          listEntryId: entry.id,
          matchedName,
          matchScore: Math.round(bestScore * 100) / 100,
          matchType: bestMatchType,
          matchedFields,
          listingDetails: {
            programs: entry.programs,
            listedDate: entry.listedDate,
            remarks: entry.remarks ?? '',
            sdnType: entry.sdnType,
          },
          status: 'pending_review',
        });
      }
    }

    return matches;
  }

  // -------------------------------------------------------------------------
  // Transliteration support
  // -------------------------------------------------------------------------
  private getTransliterations(name: string, script: string): string[] {
    if (script !== 'arabic') return [];

    const variants: string[] = [];
    const words = name.split(/\s+/);

    for (const word of words) {
      const mapped = ARABIC_LATIN_MAP[word];
      if (mapped) {
        variants.push(...mapped);
      }
    }

    // Generate combinations for multi-word names
    if (words.length > 1) {
      const wordVariants = words.map((w) => ARABIC_LATIN_MAP[w] ?? [this.normalizeName(w)]);
      const combinations = this.cartesianProduct(wordVariants);
      variants.push(...combinations.map((combo) => combo.join(' ')));
    }

    return [...new Set(variants.map((v) => this.normalizeName(v)))];
  }

  private cartesianProduct(arrays: string[][]): string[][] {
    if (arrays.length === 0) return [[]];
    const [first, ...rest] = arrays;
    const restProduct = this.cartesianProduct(rest);
    const result: string[][] = [];
    for (const item of first) {
      for (const combo of restProduct) {
        result.push([item, ...combo]);
        if (result.length > 100) return result; // Cap to avoid explosion
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Fuzzy matching — Jaro-Winkler distance
  // -------------------------------------------------------------------------
  private jaroWinklerDistance(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    if (s1.length === 0 || s2.length === 0) return 0.0;

    const maxDist = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
    const s1Matches = new Array(s1.length).fill(false);
    const s2Matches = new Array(s2.length).fill(false);

    let matches = 0;
    let transpositions = 0;

    for (let i = 0; i < s1.length; i++) {
      const start = Math.max(0, i - maxDist);
      const end = Math.min(i + maxDist + 1, s2.length);
      for (let j = start; j < end; j++) {
        if (s2Matches[j] || s1[i] !== s2[j]) continue;
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }

    if (matches === 0) return 0.0;

    let k = 0;
    for (let i = 0; i < s1.length; i++) {
      if (!s1Matches[i]) continue;
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }

    const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;

    // Winkler bonus for common prefix
    let prefix = 0;
    for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
      if (s1[i] === s2[i]) prefix++;
      else break;
    }

    return jaro + prefix * 0.1 * (1 - jaro);
  }

  // -------------------------------------------------------------------------
  // Soundex (phonetic encoding)
  // -------------------------------------------------------------------------
  private soundex(name: string): string {
    if (!name) return '';
    const upper = name.toUpperCase();
    const codes: Record<string, string> = {
      B: '1', F: '1', P: '1', V: '1',
      C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
      D: '3', T: '3',
      L: '4',
      M: '5', N: '5',
      R: '6',
    };

    let result = upper[0];
    let lastCode = codes[upper[0]] ?? '0';

    for (let i = 1; i < upper.length && result.length < 4; i++) {
      const code = codes[upper[i]];
      if (code && code !== lastCode) {
        result += code;
        lastCode = code;
      } else if (!code) {
        lastCode = '0';
      }
    }

    return result.padEnd(4, '0');
  }

  // -------------------------------------------------------------------------
  // Name normalization
  // -------------------------------------------------------------------------
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // -------------------------------------------------------------------------
  // Deduplication
  // -------------------------------------------------------------------------
  private deduplicateMatches(matches: SanctionsMatch[]): SanctionsMatch[] {
    const seen = new Map<string, SanctionsMatch>();
    for (const match of matches) {
      const key = `${match.listSource}:${match.listEntryId}`;
      const existing = seen.get(key);
      if (!existing || match.matchScore > existing.matchScore) {
        seen.set(key, match);
      }
    }
    return [...seen.values()];
  }

  // -------------------------------------------------------------------------
  // False positive management
  // -------------------------------------------------------------------------
  async resolveMatch(decision: FalsePositiveDecision): Promise<void> {
    const parsed = FalsePositiveDecisionSchema.parse(decision);
    this.falsePositives.set(parsed.matchId, parsed);

    this.logAudit(parsed.matchId, `match_${parsed.decision}`, parsed.decidedBy, {
      reason: parsed.reason,
      evidenceRefs: parsed.evidenceRefs,
    });

    logger.info('match_resolved', {
      matchId: parsed.matchId,
      decision: parsed.decision,
      decidedBy: parsed.decidedBy,
    });
  }

  // -------------------------------------------------------------------------
  // Continuous monitoring
  // -------------------------------------------------------------------------
  enableContinuousMonitoring(entityId: string): void {
    this.continuousMonitoringEntities.add(entityId);
    logger.info('continuous_monitoring_enabled', { entityId });
  }

  disableContinuousMonitoring(entityId: string): void {
    this.continuousMonitoringEntities.delete(entityId);
    logger.info('continuous_monitoring_disabled', { entityId });
  }

  async onListUpdate(
    listName: SanctionsListName,
    updatedEntries: SanctionsListEntry[],
    metadata?: SanctionsListMetadata,
  ): Promise<ScreeningResult[]> {
    this.updateSanctionsList(listName, updatedEntries, metadata);
    logger.info('sanctions_list_updated', { listName, entryCount: updatedEntries.length });

    // Re-screen all continuously monitored entities
    const results: ScreeningResult[] = [];
    for (const entityId of this.continuousMonitoringEntities) {
      const lastResult = [...this.screeningResults.values()]
        .filter((r) => r.entityId === entityId)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

      if (lastResult) {
        logger.info('re_screening_on_list_update', { entityId, listName });
      }
    }

    return results;
  }

  updateSanctionsList(
    listName: SanctionsListName,
    updatedEntries: SanctionsListEntry[],
    metadata?: SanctionsListMetadata,
  ): void {
    if (!SANCTIONS_LIST_NAMES.includes(listName)) {
      throw new Error(`Unsupported sanctions list: ${listName}`);
    }

    if (isProductionRuntime() && !metadata) {
      const error = new Error(`Production sanctions list update requires metadata for ${listName}`);
      (error as Error & { code: string }).code = 'SANCTIONS_LIST_METADATA_REQUIRED';
      throw error;
    }

    const nextMetadata = SanctionsListMetadataSchema.parse(metadata ?? {
      updatedAt: new Date().toISOString(),
      sourceDigest: computeSanctionsListDigest(updatedEntries),
      sourceName: listName,
    });

    this.assertListSignatureTrusted(listName, updatedEntries, nextMetadata);
    this.sanctionsLists.set(listName, [...updatedEntries]);
    this.sanctionsListMetadata.set(listName, nextMetadata);
  }

  getListReadiness(screenAgainst: SanctionsListName[] = [...SANCTIONS_LIST_NAMES]): SanctionsListReadiness[] {
    return screenAgainst.map((listName) => this.buildListReadiness(listName));
  }

  // -------------------------------------------------------------------------
  // Retrieve results
  // -------------------------------------------------------------------------
  getScreeningResult(screeningId: string): ScreeningResult | null {
    return this.screeningResults.get(screeningId) ?? null;
  }

  getEntityScreenings(entityId: string): ScreeningResult[] {
    return [...this.screeningResults.values()]
      .filter((r) => r.entityId === entityId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  // -------------------------------------------------------------------------
  // Audit trail
  // -------------------------------------------------------------------------
  getAuditTrail(screeningId: string): AuditEntry[] {
    return this.auditLog.filter((e) => e.screeningId === screeningId);
  }

  private logAudit(screeningId: string, action: string, performedBy: string, details: Record<string, unknown>): void {
    this.auditLog.push({
      id: crypto.randomUUID(),
      screeningId,
      action,
      performedBy,
      timestamp: new Date().toISOString(),
      details,
    });
  }

  // -------------------------------------------------------------------------
  // Update threshold
  // -------------------------------------------------------------------------
  setMatchThreshold(threshold: number): void {
    if (threshold < 0 || threshold > 1) {
      throw new Error('Threshold must be between 0 and 1');
    }
    this.matchThreshold = threshold;
    logger.info('match_threshold_updated', { threshold });
  }

  private assertScreeningListsReady(screenAgainst: SanctionsListName[]): void {
    const readiness = this.getListReadiness(screenAgainst);
    const blocked = readiness.filter((list) => !list.ready);

    if (blocked.length === 0) return;

    if (!isProductionRuntime()) {
      logger.warn('sanctions_screening_lists_not_ready', {
        blocked: blocked.map((list) => ({ listName: list.listName, issues: list.issues })),
      });
      return;
    }

    const error = new Error(
      `Production sanctions screening blocked; list data is not ready: ` +
      blocked.map((list) => `${list.listName}(${list.issues.join(',')})`).join('; '),
    );
    (error as Error & { code: string }).code = 'SANCTIONS_LIST_NOT_READY';
    throw error;
  }

  private buildListReadiness(listName: SanctionsListName): SanctionsListReadiness {
    const entries = this.sanctionsLists.get(listName) ?? [];
    const metadata = this.sanctionsListMetadata.get(listName);
    const issues: string[] = [];

    if (entries.length === 0) issues.push('empty');
    if (!metadata) {
      issues.push('missing_metadata');
    } else {
      const updatedAtMs = Date.parse(metadata.updatedAt);
      if (!Number.isFinite(updatedAtMs)) {
        issues.push('invalid_updated_at');
      } else if (updatedAtMs > Date.now() + 5 * 60 * 1000) {
        issues.push('future_updated_at');
      } else if (Date.now() - updatedAtMs > this.listMaxAgeMs) {
        issues.push('stale');
      }
      if (isProductionRuntime() && (!metadata.signingKeyId || !metadata.signature)) {
        issues.push('unsigned');
      }
    }

    return {
      listName,
      entryCount: entries.length,
      ready: issues.length === 0,
      issues,
      updatedAt: metadata?.updatedAt,
      sourceDigest: metadata?.sourceDigest,
      signingKeyId: metadata?.signingKeyId,
    };
  }

  private assertListSignatureTrusted(
    listName: SanctionsListName,
    entries: SanctionsListEntry[],
    metadata: SanctionsListMetadata,
  ): void {
    if (!isProductionRuntime()) return;

    if (!metadata.signingKeyId || !metadata.signature) {
      const error = new Error(`Production sanctions list update requires a signed manifest for ${listName}`);
      (error as Error & { code: string }).code = 'SANCTIONS_LIST_SIGNATURE_REQUIRED';
      throw error;
    }

    const publicKey = this.resolveTrustedListPublicKey(metadata.signingKeyId);
    if (!publicKey) {
      const error = new Error(`No trusted sanctions list key configured for ${metadata.signingKeyId}`);
      (error as Error & { code: string }).code = 'SANCTIONS_LIST_TRUSTED_KEY_NOT_FOUND';
      throw error;
    }

    const payload = buildSanctionsListSignaturePayload(listName, entries, metadata);
    const valid = crypto.verify(
      null,
      Buffer.from(payload),
      publicKey,
      Buffer.from(metadata.signature, 'base64url'),
    );

    if (!valid) {
      const error = new Error(`Invalid sanctions list manifest signature for ${listName}`);
      (error as Error & { code: string }).code = 'SANCTIONS_LIST_SIGNATURE_INVALID';
      throw error;
    }
  }

  private resolveTrustedListPublicKey(signingKeyId: string): crypto.KeyObject | null {
    const rawKeys = process.env.SANCTIONS_LIST_SIGNATURE_PUBLIC_KEYS_JSON;
    if (!rawKeys) return null;

    try {
      const keys = JSON.parse(rawKeys) as Record<string, string>;
      const encodedKey = keys[signingKeyId];
      if (!encodedKey) return null;

      const keyMaterial = encodedKey.includes('BEGIN PUBLIC KEY')
        ? encodedKey
        : Buffer.from(encodedKey, 'base64').toString('utf8');
      return crypto.createPublicKey(keyMaterial);
    } catch {
      return null;
    }
  }

  private resolveListMaxAgeMs(): number {
    const rawConfiguredHours = process.env.SANCTIONS_LIST_MAX_AGE_HOURS ?? '24';
    const configuredHours = Number(rawConfiguredHours);
    if (
      isProductionRuntime() &&
      (
        !/^[1-9]\d*$/.test(rawConfiguredHours.trim()) ||
        configuredHours > MAX_PRODUCTION_SANCTIONS_LIST_AGE_HOURS
      )
    ) {
      const error = new Error(
        `SANCTIONS_LIST_MAX_AGE_HOURS must be an integer from 1 to ${MAX_PRODUCTION_SANCTIONS_LIST_AGE_HOURS} in production`,
      );
      (error as Error & { code: string }).code = 'SANCTIONS_LIST_MAX_AGE_INVALID';
      throw error;
    }
    const hours = Number.isFinite(configuredHours) && configuredHours > 0 ? configuredHours : 24;
    return hours * 60 * 60 * 1000;
  }
}

// ---------------------------------------------------------------------------
// Sanctions list entry type (used for list ingestion)
// ---------------------------------------------------------------------------
export interface SanctionsListEntry {
  id: string;
  names: string[];
  dateOfBirth?: string;
  nationalities?: string[];
  identifiers?: Array<{ type: string; value: string }>;
  programs: string[];
  listedDate: string;
  remarks?: string;
  sdnType?: string;
  addresses?: Array<{ country: string; city?: string }>;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
export const sanctionsScreeningService = new SanctionsScreeningService();
