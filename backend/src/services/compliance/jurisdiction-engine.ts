import { z } from 'zod';
import { createLogger, format, transports } from 'winston';
import { EventEmitter } from 'events';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const logger = createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { service: 'jurisdiction-engine' },
  transports: [new transports.Console()],
});

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------
export const JurisdictionCodeSchema = z.enum([
  'AE-CBUAE', 'AE-SCA', 'AE-ADGM', 'AE-DIFC',
  'EU-EIDAS', 'EU-GDPR', 'EU-MICA',
  'US-FINCEN', 'US-SEC', 'US-NY', 'US-CA', 'US-TX', 'US-FL',
  'SG-MAS',
  'UK-FCA',
  'BH-CBB',
  'SA-SAMA',
]);

export type JurisdictionCode = z.infer<typeof JurisdictionCodeSchema>;

export const ComplianceRuleSchema = z.object({
  id: z.string().uuid(),
  jurisdictionCode: JurisdictionCodeSchema,
  ruleType: z.enum(['kyc', 'aml', 'data_residency', 'reporting', 'licensing', 'consent', 'sanctions']),
  name: z.string(),
  description: z.string(),
  requiredCredentials: z.array(z.string()),
  dataRetentionDays: z.number().int().positive(),
  enforcementDate: z.string().datetime(),
  expiryDate: z.string().datetime().optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  automatable: z.boolean(),
});

export type ComplianceRule = z.infer<typeof ComplianceRuleSchema>;

export const ComplianceEvaluationRequestSchema = z.object({
  entityId: z.string(),
  entityType: z.enum(['individual', 'corporate', 'institution']),
  jurisdictions: z.array(JurisdictionCodeSchema),
  credentials: z.array(z.object({
    credentialType: z.string(),
    issuerId: z.string(),
    issuingJurisdiction: JurisdictionCodeSchema.optional(),
    claims: z.record(z.unknown()),
    issuedAt: z.string().datetime(),
    expiresAt: z.string().datetime().optional(),
  })),
  operationType: z.enum(['onboarding', 'transaction', 'transfer', 'periodic_review']),
});

export type ComplianceEvaluationRequest = z.infer<typeof ComplianceEvaluationRequestSchema>;

export const CrossBorderAssessmentSchema = z.object({
  sourceJurisdiction: JurisdictionCodeSchema,
  targetJurisdiction: JurisdictionCodeSchema,
  entityId: z.string(),
  dataCategories: z.array(z.enum(['personal', 'financial', 'biometric', 'health', 'criminal'])),
  purpose: z.string(),
});

export type CrossBorderAssessment = z.infer<typeof CrossBorderAssessmentSchema>;

// ---------------------------------------------------------------------------
// Jurisdiction metadata
// ---------------------------------------------------------------------------
interface JurisdictionMeta {
  code: JurisdictionCode;
  name: string;
  region: string;
  dataResidencyRequired: boolean;
  retentionDays: number;
  reportingCurrency: string;
  regulatoryBody: string;
  consentModel: 'opt-in' | 'opt-out' | 'explicit';
  crossBorderRestricted: boolean;
}

const JURISDICTION_REGISTRY: Map<JurisdictionCode, JurisdictionMeta> = new Map([
  ['AE-CBUAE', { code: 'AE-CBUAE', name: 'UAE Central Bank', region: 'mena', dataResidencyRequired: true, retentionDays: 1825, reportingCurrency: 'AED', regulatoryBody: 'Central Bank of UAE', consentModel: 'explicit', crossBorderRestricted: false }],
  ['AE-SCA', { code: 'AE-SCA', name: 'Securities & Commodities Authority', region: 'mena', dataResidencyRequired: true, retentionDays: 1825, reportingCurrency: 'AED', regulatoryBody: 'SCA', consentModel: 'explicit', crossBorderRestricted: false }],
  ['AE-ADGM', { code: 'AE-ADGM', name: 'Abu Dhabi Global Market', region: 'mena', dataResidencyRequired: false, retentionDays: 2555, reportingCurrency: 'USD', regulatoryBody: 'FSRA', consentModel: 'explicit', crossBorderRestricted: false }],
  ['AE-DIFC', { code: 'AE-DIFC', name: 'Dubai International Financial Centre', region: 'mena', dataResidencyRequired: false, retentionDays: 2555, reportingCurrency: 'USD', regulatoryBody: 'DFSA', consentModel: 'explicit', crossBorderRestricted: false }],
  ['EU-EIDAS', { code: 'EU-EIDAS', name: 'eIDAS 2.0', region: 'europe', dataResidencyRequired: true, retentionDays: 3650, reportingCurrency: 'EUR', regulatoryBody: 'EU Commission', consentModel: 'explicit', crossBorderRestricted: false }],
  ['EU-GDPR', { code: 'EU-GDPR', name: 'GDPR', region: 'europe', dataResidencyRequired: true, retentionDays: 1825, reportingCurrency: 'EUR', regulatoryBody: 'Data Protection Authorities', consentModel: 'explicit', crossBorderRestricted: true }],
  ['EU-MICA', { code: 'EU-MICA', name: 'Markets in Crypto-Assets', region: 'europe', dataResidencyRequired: true, retentionDays: 1825, reportingCurrency: 'EUR', regulatoryBody: 'EBA/ESMA', consentModel: 'explicit', crossBorderRestricted: false }],
  ['US-FINCEN', { code: 'US-FINCEN', name: 'FinCEN', region: 'north_america', dataResidencyRequired: false, retentionDays: 1825, reportingCurrency: 'USD', regulatoryBody: 'FinCEN', consentModel: 'opt-out', crossBorderRestricted: false }],
  ['US-SEC', { code: 'US-SEC', name: 'SEC', region: 'north_america', dataResidencyRequired: false, retentionDays: 2555, reportingCurrency: 'USD', regulatoryBody: 'SEC', consentModel: 'opt-out', crossBorderRestricted: false }],
  ['US-NY', { code: 'US-NY', name: 'New York DFS', region: 'north_america', dataResidencyRequired: false, retentionDays: 2555, reportingCurrency: 'USD', regulatoryBody: 'NYDFS', consentModel: 'opt-out', crossBorderRestricted: false }],
  ['US-CA', { code: 'US-CA', name: 'California CCPA/CPRA', region: 'north_america', dataResidencyRequired: false, retentionDays: 1825, reportingCurrency: 'USD', regulatoryBody: 'CPPA', consentModel: 'opt-out', crossBorderRestricted: false }],
  ['US-TX', { code: 'US-TX', name: 'Texas TDBA', region: 'north_america', dataResidencyRequired: false, retentionDays: 1825, reportingCurrency: 'USD', regulatoryBody: 'TDBA', consentModel: 'opt-out', crossBorderRestricted: false }],
  ['US-FL', { code: 'US-FL', name: 'Florida OFR', region: 'north_america', dataResidencyRequired: false, retentionDays: 1825, reportingCurrency: 'USD', regulatoryBody: 'OFR', consentModel: 'opt-out', crossBorderRestricted: false }],
  ['SG-MAS', { code: 'SG-MAS', name: 'Monetary Authority of Singapore', region: 'asia_pacific', dataResidencyRequired: false, retentionDays: 1825, reportingCurrency: 'SGD', regulatoryBody: 'MAS', consentModel: 'explicit', crossBorderRestricted: false }],
  ['UK-FCA', { code: 'UK-FCA', name: 'Financial Conduct Authority', region: 'europe', dataResidencyRequired: true, retentionDays: 1825, reportingCurrency: 'GBP', regulatoryBody: 'FCA', consentModel: 'explicit', crossBorderRestricted: true }],
  ['BH-CBB', { code: 'BH-CBB', name: 'Central Bank of Bahrain', region: 'mena', dataResidencyRequired: true, retentionDays: 1825, reportingCurrency: 'BHD', regulatoryBody: 'CBB', consentModel: 'explicit', crossBorderRestricted: false }],
  ['SA-SAMA', { code: 'SA-SAMA', name: 'Saudi Central Bank', region: 'mena', dataResidencyRequired: true, retentionDays: 3650, reportingCurrency: 'SAR', regulatoryBody: 'SAMA', consentModel: 'explicit', crossBorderRestricted: true }],
]);

// ---------------------------------------------------------------------------
// Mutual Recognition Agreements
// ---------------------------------------------------------------------------
interface MutualRecognition {
  jurisdictions: [JurisdictionCode, JurisdictionCode];
  credentialTypes: string[];
  effectiveDate: string;
  conditions: string[];
}

const MUTUAL_RECOGNITION_AGREEMENTS: MutualRecognition[] = [
  { jurisdictions: ['AE-ADGM', 'UK-FCA'], credentialTypes: ['kyc_enhanced', 'accredited_investor'], effectiveDate: '2024-01-01', conditions: ['credential_age_lt_180d'] },
  { jurisdictions: ['AE-DIFC', 'SG-MAS'], credentialTypes: ['kyc_enhanced', 'corporate_verification'], effectiveDate: '2024-06-01', conditions: ['credential_age_lt_365d'] },
  { jurisdictions: ['EU-EIDAS', 'UK-FCA'], credentialTypes: ['national_id', 'kyc_basic', 'kyc_enhanced'], effectiveDate: '2024-03-01', conditions: ['post_brexit_agreement'] },
  { jurisdictions: ['SG-MAS', 'BH-CBB'], credentialTypes: ['kyc_basic', 'aml_clearance'], effectiveDate: '2024-09-01', conditions: [] },
  { jurisdictions: ['AE-CBUAE', 'BH-CBB'], credentialTypes: ['kyc_basic', 'kyc_enhanced', 'aml_clearance', 'bank_reference'], effectiveDate: '2023-01-01', conditions: ['gcc_cooperation'] },
  { jurisdictions: ['AE-CBUAE', 'SA-SAMA'], credentialTypes: ['kyc_basic', 'kyc_enhanced', 'aml_clearance'], effectiveDate: '2023-06-01', conditions: ['gcc_cooperation'] },
  { jurisdictions: ['EU-EIDAS', 'EU-MICA'], credentialTypes: ['national_id', 'kyc_basic', 'kyc_enhanced', 'corporate_verification'], effectiveDate: '2024-01-01', conditions: ['eu_internal'] },
];

// ---------------------------------------------------------------------------
// Jurisdiction-specific required credentials
// ---------------------------------------------------------------------------
const JURISDICTION_REQUIREMENTS: Map<JurisdictionCode, Map<string, string[]>> = new Map([
  ['AE-CBUAE', new Map([
    ['onboarding', ['emirates_id', 'passport', 'proof_of_address', 'source_of_funds']],
    ['transaction', ['kyc_basic', 'aml_clearance']],
    ['transfer', ['kyc_enhanced', 'sanctions_clearance', 'source_of_funds']],
    ['periodic_review', ['kyc_enhanced', 'aml_clearance', 'proof_of_address']],
  ])],
  ['AE-ADGM', new Map([
    ['onboarding', ['passport', 'proof_of_address', 'accredited_investor']],
    ['transaction', ['kyc_enhanced', 'aml_clearance']],
    ['transfer', ['kyc_enhanced', 'sanctions_clearance']],
    ['periodic_review', ['kyc_enhanced', 'aml_clearance']],
  ])],
  ['AE-DIFC', new Map([
    ['onboarding', ['passport', 'proof_of_address', 'professional_reference']],
    ['transaction', ['kyc_enhanced', 'aml_clearance']],
    ['transfer', ['kyc_enhanced', 'sanctions_clearance']],
    ['periodic_review', ['kyc_enhanced', 'aml_clearance']],
  ])],
  ['AE-SCA', new Map([
    ['onboarding', ['emirates_id', 'passport', 'proof_of_address']],
    ['transaction', ['kyc_basic']],
    ['transfer', ['kyc_enhanced', 'aml_clearance']],
    ['periodic_review', ['kyc_basic', 'aml_clearance']],
  ])],
  ['EU-EIDAS', new Map([
    ['onboarding', ['national_id', 'proof_of_address', 'eidas_qualified_cert']],
    ['transaction', ['kyc_basic']],
    ['transfer', ['kyc_enhanced', 'gdpr_consent']],
    ['periodic_review', ['kyc_basic', 'eidas_qualified_cert']],
  ])],
  ['EU-GDPR', new Map([
    ['onboarding', ['national_id', 'gdpr_consent', 'privacy_notice_ack']],
    ['transaction', ['gdpr_consent']],
    ['transfer', ['gdpr_consent', 'data_transfer_agreement']],
    ['periodic_review', ['gdpr_consent']],
  ])],
  ['EU-MICA', new Map([
    ['onboarding', ['national_id', 'kyc_enhanced', 'mica_classification']],
    ['transaction', ['kyc_basic', 'mica_classification']],
    ['transfer', ['kyc_enhanced', 'travel_rule_compliance']],
    ['periodic_review', ['kyc_enhanced', 'mica_classification']],
  ])],
  ['US-FINCEN', new Map([
    ['onboarding', ['ssn_verification', 'government_id', 'proof_of_address']],
    ['transaction', ['kyc_basic', 'ctr_clearance']],
    ['transfer', ['kyc_enhanced', 'sanctions_clearance', 'travel_rule_compliance']],
    ['periodic_review', ['kyc_enhanced', 'aml_clearance']],
  ])],
  ['US-SEC', new Map([
    ['onboarding', ['government_id', 'accredited_investor', 'ssn_verification']],
    ['transaction', ['kyc_enhanced', 'accredited_investor']],
    ['transfer', ['kyc_enhanced', 'accredited_investor']],
    ['periodic_review', ['accredited_investor', 'kyc_enhanced']],
  ])],
  ['US-NY', new Map([
    ['onboarding', ['government_id', 'ssn_verification', 'bitlicense_clearance']],
    ['transaction', ['kyc_enhanced']],
    ['transfer', ['kyc_enhanced', 'sanctions_clearance']],
    ['periodic_review', ['kyc_enhanced', 'aml_clearance']],
  ])],
  ['US-CA', new Map([
    ['onboarding', ['government_id', 'ccpa_consent', 'proof_of_address']],
    ['transaction', ['kyc_basic']],
    ['transfer', ['kyc_basic', 'ccpa_consent']],
    ['periodic_review', ['kyc_basic', 'ccpa_consent']],
  ])],
  ['US-TX', new Map([
    ['onboarding', ['government_id', 'ssn_verification']],
    ['transaction', ['kyc_basic']],
    ['transfer', ['kyc_basic']],
    ['periodic_review', ['kyc_basic']],
  ])],
  ['US-FL', new Map([
    ['onboarding', ['government_id', 'ssn_verification', 'proof_of_address']],
    ['transaction', ['kyc_basic']],
    ['transfer', ['kyc_basic']],
    ['periodic_review', ['kyc_basic']],
  ])],
  ['SG-MAS', new Map([
    ['onboarding', ['nric_or_passport', 'proof_of_address', 'source_of_wealth']],
    ['transaction', ['kyc_enhanced']],
    ['transfer', ['kyc_enhanced', 'sanctions_clearance', 'travel_rule_compliance']],
    ['periodic_review', ['kyc_enhanced', 'aml_clearance']],
  ])],
  ['UK-FCA', new Map([
    ['onboarding', ['passport', 'proof_of_address', 'source_of_funds']],
    ['transaction', ['kyc_enhanced']],
    ['transfer', ['kyc_enhanced', 'sanctions_clearance', 'travel_rule_compliance']],
    ['periodic_review', ['kyc_enhanced', 'aml_clearance']],
  ])],
  ['BH-CBB', new Map([
    ['onboarding', ['cpr_or_passport', 'proof_of_address', 'bank_reference']],
    ['transaction', ['kyc_basic']],
    ['transfer', ['kyc_enhanced', 'sanctions_clearance']],
    ['periodic_review', ['kyc_enhanced', 'aml_clearance']],
  ])],
  ['SA-SAMA', new Map([
    ['onboarding', ['national_id_absher', 'proof_of_address', 'source_of_funds']],
    ['transaction', ['kyc_enhanced']],
    ['transfer', ['kyc_enhanced', 'sanctions_clearance', 'source_of_funds']],
    ['periodic_review', ['kyc_enhanced', 'aml_clearance', 'source_of_funds']],
  ])],
]);

// ---------------------------------------------------------------------------
// Compliance evaluation result types
// ---------------------------------------------------------------------------
export interface ComplianceStatus {
  entityId: string;
  jurisdiction: JurisdictionCode;
  overallStatus: 'compliant' | 'non_compliant' | 'partial' | 'pending_review';
  missingCredentials: string[];
  expiringCredentials: Array<{ credentialType: string; expiresAt: string; daysRemaining: number }>;
  rules: Array<{ ruleId: string; name: string; status: 'pass' | 'fail' | 'warning'; detail: string }>;
  lastEvaluated: string;
  nextReviewDate: string;
}

export interface CrossBorderResult {
  allowed: boolean;
  sourceJurisdiction: JurisdictionCode;
  targetJurisdiction: JurisdictionCode;
  mutualRecognition: boolean;
  acceptedCredentials: string[];
  additionalRequired: string[];
  dataTransferMechanism: 'adequacy_decision' | 'standard_contractual_clauses' | 'binding_corporate_rules' | 'explicit_consent' | 'not_required';
  restrictions: string[];
}

export interface RegulatoryChangeNotification {
  id: string;
  jurisdiction: JurisdictionCode;
  changeType: 'new_requirement' | 'amendment' | 'repeal' | 'effective_date_change';
  title: string;
  description: string;
  effectiveDate: string;
  impactedEntities: string[];
  actionRequired: string;
  publishedAt: string;
}

// ---------------------------------------------------------------------------
// JurisdictionEngine
// ---------------------------------------------------------------------------
export class JurisdictionEngine extends EventEmitter {
  private complianceCache: Map<string, ComplianceStatus> = new Map();
  private regulatoryChanges: RegulatoryChangeNotification[] = [];
  private evaluationHistory: Map<string, ComplianceStatus[]> = new Map();

  constructor() {
    super();
    logger.info('JurisdictionEngine initialized', { jurisdictions: JURISDICTION_REGISTRY.size });
  }

  // -------------------------------------------------------------------------
  // Detect jurisdictions from credential attributes
  // -------------------------------------------------------------------------
  detectJurisdictions(claims: Record<string, unknown>): JurisdictionCode[] {
    const detected: Set<JurisdictionCode> = new Set();
    const country = (claims.country ?? claims.nationality ?? claims.residence_country ?? '') as string;
    const idType = (claims.id_type ?? claims.credential_type ?? '') as string;

    const countryMap: Record<string, JurisdictionCode[]> = {
      AE: ['AE-CBUAE', 'AE-SCA'],
      UAE: ['AE-CBUAE', 'AE-SCA'],
      ADGM: ['AE-ADGM'],
      DIFC: ['AE-DIFC'],
      US: ['US-FINCEN'],
      USA: ['US-FINCEN'],
      GB: ['UK-FCA'],
      UK: ['UK-FCA'],
      SG: ['SG-MAS'],
      BH: ['BH-CBB'],
      SA: ['SA-SAMA'],
      DE: ['EU-EIDAS', 'EU-GDPR', 'EU-MICA'],
      FR: ['EU-EIDAS', 'EU-GDPR', 'EU-MICA'],
      IT: ['EU-EIDAS', 'EU-GDPR', 'EU-MICA'],
      ES: ['EU-EIDAS', 'EU-GDPR', 'EU-MICA'],
      NL: ['EU-EIDAS', 'EU-GDPR', 'EU-MICA'],
    };

    const upper = country.toUpperCase();
    if (countryMap[upper]) {
      countryMap[upper].forEach((j) => detected.add(j));
    }

    // US state-level detection
    const state = (claims.state ?? claims.region ?? '') as string;
    const stateUpper = state.toUpperCase();
    if (stateUpper === 'NY' || stateUpper === 'NEW YORK') detected.add('US-NY');
    if (stateUpper === 'CA' || stateUpper === 'CALIFORNIA') detected.add('US-CA');
    if (stateUpper === 'TX' || stateUpper === 'TEXAS') detected.add('US-TX');
    if (stateUpper === 'FL' || stateUpper === 'FLORIDA') detected.add('US-FL');

    // Detect from credential / ID types
    if (idType.includes('emirates_id')) detected.add('AE-CBUAE');
    if (idType.includes('absher')) detected.add('SA-SAMA');
    if (idType.includes('nric')) detected.add('SG-MAS');
    if (idType.includes('cpr')) detected.add('BH-CBB');
    if (idType.includes('eidas')) { detected.add('EU-EIDAS'); detected.add('EU-GDPR'); }
    if (idType.includes('ssn')) detected.add('US-FINCEN');

    // Financial zone detection
    const zone = (claims.financial_zone ?? '') as string;
    if (zone.toUpperCase() === 'ADGM') detected.add('AE-ADGM');
    if (zone.toUpperCase() === 'DIFC') detected.add('AE-DIFC');

    logger.debug('jurisdiction_detection', { claims_keys: Object.keys(claims), detected: [...detected] });
    return [...detected];
  }

  // -------------------------------------------------------------------------
  // Evaluate compliance for entity against one or more jurisdictions
  // -------------------------------------------------------------------------
  async evaluateCompliance(request: ComplianceEvaluationRequest): Promise<ComplianceStatus[]> {
    const parsed = ComplianceEvaluationRequestSchema.parse(request);
    const results: ComplianceStatus[] = [];

    for (const jurisdiction of parsed.jurisdictions) {
      const status = await this.evaluateJurisdiction(parsed, jurisdiction);
      results.push(status);

      const cacheKey = `${parsed.entityId}:${jurisdiction}`;
      this.complianceCache.set(cacheKey, status);

      const history = this.evaluationHistory.get(cacheKey) ?? [];
      history.push(status);
      if (history.length > 100) history.shift();
      this.evaluationHistory.set(cacheKey, history);
    }

    logger.info('compliance_evaluation_complete', {
      entityId: parsed.entityId,
      jurisdictions: parsed.jurisdictions,
      results: results.map((r) => ({ jurisdiction: r.jurisdiction, status: r.overallStatus })),
    });

    return results;
  }

  private async evaluateJurisdiction(
    request: ComplianceEvaluationRequest,
    jurisdiction: JurisdictionCode,
  ): Promise<ComplianceStatus> {
    const requirements = JURISDICTION_REQUIREMENTS.get(jurisdiction);
    if (!requirements) {
      throw new ComplianceError(`Unsupported jurisdiction: ${jurisdiction}`, 'JURISDICTION_NOT_FOUND');
    }

    const requiredCreds = requirements.get(request.operationType) ?? [];
    const presentedTypes = new Set(request.credentials.map((c) => c.credentialType));
    const missingCredentials = requiredCreds.filter((r) => !presentedTypes.has(r));
    const now = new Date();

    const expiringCredentials = request.credentials
      .filter((c) => c.expiresAt)
      .map((c) => {
        const expiry = new Date(c.expiresAt!);
        const daysRemaining = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return { credentialType: c.credentialType, expiresAt: c.expiresAt!, daysRemaining };
      })
      .filter((c) => c.daysRemaining <= 90);

    // Emit warnings for credentials expiring within 30 days
    for (const exp of expiringCredentials) {
      if (exp.daysRemaining <= 30) {
        this.emit('credential_expiry_warning', {
          entityId: request.entityId,
          jurisdiction,
          credential: exp,
        });
      }
    }

    const rules = this.evaluateRules(request, jurisdiction, missingCredentials);

    let overallStatus: ComplianceStatus['overallStatus'] = 'compliant';
    const hasCriticalFailure = rules.some((r) => r.status === 'fail');
    const hasWarning = rules.some((r) => r.status === 'warning');

    if (missingCredentials.length > 0 || hasCriticalFailure) {
      overallStatus = missingCredentials.length === requiredCreds.length ? 'non_compliant' : 'partial';
    } else if (hasWarning) {
      overallStatus = 'pending_review';
    }

    const meta = JURISDICTION_REGISTRY.get(jurisdiction)!;
    const reviewInterval = meta.retentionDays > 2000 ? 365 : 180;
    const nextReviewDate = new Date(now.getTime() + reviewInterval * 24 * 60 * 60 * 1000);

    return {
      entityId: request.entityId,
      jurisdiction,
      overallStatus,
      missingCredentials,
      expiringCredentials,
      rules,
      lastEvaluated: now.toISOString(),
      nextReviewDate: nextReviewDate.toISOString(),
    };
  }

  private evaluateRules(
    request: ComplianceEvaluationRequest,
    jurisdiction: JurisdictionCode,
    missingCreds: string[],
  ): ComplianceStatus['rules'] {
    const rules: ComplianceStatus['rules'] = [];

    // KYC completeness
    rules.push({
      ruleId: crypto.randomUUID(),
      name: 'KYC Completeness',
      status: missingCreds.length === 0 ? 'pass' : 'fail',
      detail: missingCreds.length === 0 ? 'All required KYC credentials present' : `Missing: ${missingCreds.join(', ')}`,
    });

    // Credential freshness
    const now = Date.now();
    const staleCredentials = request.credentials.filter((c) => {
      const age = now - new Date(c.issuedAt).getTime();
      return age > 365 * 24 * 60 * 60 * 1000;
    });
    rules.push({
      ruleId: crypto.randomUUID(),
      name: 'Credential Freshness',
      status: staleCredentials.length === 0 ? 'pass' : 'warning',
      detail: staleCredentials.length === 0 ? 'All credentials within validity period' : `${staleCredentials.length} credential(s) older than 1 year`,
    });

    // Issuer jurisdiction match
    const meta = JURISDICTION_REGISTRY.get(jurisdiction)!;
    const crossJurisdictionCreds = request.credentials.filter(
      (c) => c.issuingJurisdiction && c.issuingJurisdiction !== jurisdiction,
    );
    const hasRecognition = crossJurisdictionCreds.every((c) =>
      this.checkMutualRecognition(c.issuingJurisdiction!, jurisdiction, c.credentialType),
    );
    rules.push({
      ruleId: crypto.randomUUID(),
      name: 'Issuer Jurisdiction Acceptance',
      status: crossJurisdictionCreds.length === 0 || hasRecognition ? 'pass' : 'warning',
      detail: crossJurisdictionCreds.length === 0 ? 'All credentials from target jurisdiction' : hasRecognition ? 'Cross-jurisdiction credentials covered by MRA' : 'Some credentials from unrecognized jurisdictions',
    });

    // Data residency check
    if (meta.dataResidencyRequired) {
      rules.push({
        ruleId: crypto.randomUUID(),
        name: 'Data Residency',
        status: 'pass',
        detail: `Data residency enforced for ${meta.code}`,
      });
    }

    // Consent model check
    if (meta.consentModel === 'explicit') {
      const hasConsent = request.credentials.some(
        (c) => c.credentialType.includes('consent') || c.claims.consent_given === true,
      );
      rules.push({
        ruleId: crypto.randomUUID(),
        name: 'Explicit Consent',
        status: hasConsent ? 'pass' : 'warning',
        detail: hasConsent ? 'Explicit consent credential present' : 'Explicit consent may be required',
      });
    }

    return rules;
  }

  // -------------------------------------------------------------------------
  // Cross-border compliance mapping
  // -------------------------------------------------------------------------
  assessCrossBorder(assessment: CrossBorderAssessment): CrossBorderResult {
    const parsed = CrossBorderAssessmentSchema.parse(assessment);
    const { sourceJurisdiction, targetJurisdiction, dataCategories } = parsed;

    const sourceMeta = JURISDICTION_REGISTRY.get(sourceJurisdiction);
    const targetMeta = JURISDICTION_REGISTRY.get(targetJurisdiction);
    if (!sourceMeta || !targetMeta) {
      throw new ComplianceError('Invalid jurisdiction code', 'INVALID_JURISDICTION');
    }

    const mra = this.findMutualRecognition(sourceJurisdiction, targetJurisdiction);
    const acceptedCredentials = mra ? mra.credentialTypes : [];

    const sourceReqs = JURISDICTION_REQUIREMENTS.get(sourceJurisdiction)?.get('transfer') ?? [];
    const targetReqs = JURISDICTION_REQUIREMENTS.get(targetJurisdiction)?.get('onboarding') ?? [];
    const additionalRequired = targetReqs.filter((r) => !sourceReqs.includes(r) && !acceptedCredentials.includes(r));

    let dataTransferMechanism: CrossBorderResult['dataTransferMechanism'] = 'not_required';
    const restrictions: string[] = [];

    if (sourceMeta.region === 'europe' || targetMeta.region === 'europe') {
      if (sourceMeta.region === targetMeta.region) {
        dataTransferMechanism = 'adequacy_decision';
      } else if (targetMeta.code === 'UK-FCA' || sourceMeta.code === 'UK-FCA') {
        dataTransferMechanism = 'adequacy_decision';
      } else {
        dataTransferMechanism = 'standard_contractual_clauses';
        restrictions.push('EU SCCs required for cross-border personal data transfer');
      }
    }

    if (dataCategories.includes('biometric')) {
      restrictions.push('Biometric data transfer requires explicit consent in both jurisdictions');
    }
    if (dataCategories.includes('health')) {
      restrictions.push('Health data subject to additional safeguards');
    }
    if (targetMeta.crossBorderRestricted) {
      restrictions.push(`${targetMeta.name} imposes additional cross-border restrictions`);
    }

    const allowed = restrictions.length < 3 && (mra !== null || !targetMeta.crossBorderRestricted);

    logger.info('cross_border_assessment', {
      source: sourceJurisdiction,
      target: targetJurisdiction,
      allowed,
      mutualRecognition: mra !== null,
    });

    return {
      allowed,
      sourceJurisdiction,
      targetJurisdiction,
      mutualRecognition: mra !== null,
      acceptedCredentials,
      additionalRequired,
      dataTransferMechanism,
      restrictions,
    };
  }

  // -------------------------------------------------------------------------
  // Regulatory requirement diff
  // -------------------------------------------------------------------------
  getRequirementDiff(
    currentJurisdictions: JurisdictionCode[],
    newJurisdiction: JurisdictionCode,
    operationType: string,
  ): { newRequirements: string[]; alreadySatisfied: string[]; totalRequired: string[] } {
    const currentReqs = new Set<string>();
    for (const j of currentJurisdictions) {
      const reqs = JURISDICTION_REQUIREMENTS.get(j)?.get(operationType) ?? [];
      reqs.forEach((r) => currentReqs.add(r));
    }

    const newReqs = JURISDICTION_REQUIREMENTS.get(newJurisdiction)?.get(operationType) ?? [];
    const alreadySatisfied = newReqs.filter((r) => currentReqs.has(r));
    const newRequirements = newReqs.filter((r) => !currentReqs.has(r));

    return { newRequirements, alreadySatisfied, totalRequired: newReqs };
  }

  // -------------------------------------------------------------------------
  // Compliance status retrieval with expiry warnings
  // -------------------------------------------------------------------------
  getComplianceStatus(entityId: string, jurisdiction: JurisdictionCode): ComplianceStatus | null {
    const cacheKey = `${entityId}:${jurisdiction}`;
    return this.complianceCache.get(cacheKey) ?? null;
  }

  getComplianceHistory(entityId: string, jurisdiction: JurisdictionCode): ComplianceStatus[] {
    const cacheKey = `${entityId}:${jurisdiction}`;
    return this.evaluationHistory.get(cacheKey) ?? [];
  }

  // -------------------------------------------------------------------------
  // Regulatory change notifications
  // -------------------------------------------------------------------------
  publishRegulatoryChange(notification: Omit<RegulatoryChangeNotification, 'id' | 'publishedAt'>): RegulatoryChangeNotification {
    const change: RegulatoryChangeNotification = {
      ...notification,
      id: crypto.randomUUID(),
      publishedAt: new Date().toISOString(),
    };
    this.regulatoryChanges.push(change);
    this.emit('regulatory_change', change);

    logger.info('regulatory_change_published', { id: change.id, jurisdiction: change.jurisdiction, type: change.changeType });
    return change;
  }

  getRegulatoryChanges(jurisdiction?: JurisdictionCode, since?: Date): RegulatoryChangeNotification[] {
    let changes = this.regulatoryChanges;
    if (jurisdiction) {
      changes = changes.filter((c) => c.jurisdiction === jurisdiction);
    }
    if (since) {
      changes = changes.filter((c) => new Date(c.publishedAt) >= since);
    }
    return changes.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }

  // -------------------------------------------------------------------------
  // Jurisdiction data retention policies
  // -------------------------------------------------------------------------
  getDataRetentionPolicy(jurisdiction: JurisdictionCode): {
    retentionDays: number;
    dataResidencyRequired: boolean;
    consentModel: string;
    regulatoryBody: string;
  } {
    const meta = JURISDICTION_REGISTRY.get(jurisdiction);
    if (!meta) {
      throw new ComplianceError(`Unknown jurisdiction: ${jurisdiction}`, 'JURISDICTION_NOT_FOUND');
    }
    return {
      retentionDays: meta.retentionDays,
      dataResidencyRequired: meta.dataResidencyRequired,
      consentModel: meta.consentModel,
      regulatoryBody: meta.regulatoryBody,
    };
  }

  // -------------------------------------------------------------------------
  // List supported jurisdictions
  // -------------------------------------------------------------------------
  listJurisdictions(): JurisdictionMeta[] {
    return [...JURISDICTION_REGISTRY.values()];
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------
  private checkMutualRecognition(source: JurisdictionCode, target: JurisdictionCode, credentialType: string): boolean {
    const mra = this.findMutualRecognition(source, target);
    return mra !== null && mra.credentialTypes.includes(credentialType);
  }

  private findMutualRecognition(a: JurisdictionCode, b: JurisdictionCode): MutualRecognition | null {
    return MUTUAL_RECOGNITION_AGREEMENTS.find(
      (mra) =>
        (mra.jurisdictions[0] === a && mra.jurisdictions[1] === b) ||
        (mra.jurisdictions[0] === b && mra.jurisdictions[1] === a),
    ) ?? null;
  }
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------
export class ComplianceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'ComplianceError';
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
export const jurisdictionEngine = new JurisdictionEngine();
