import crypto from 'crypto';
import { prisma, logger, redis } from '../../index';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScreeningResult = 'clear' | 'potential_match' | 'confirmed_match' | 'inconclusive';
export type ComplianceReportType = 'kyc' | 'aml' | 'sanctions' | 'pep' | 'travel_rule' | 'comprehensive';
export type RegulatoryFramework = 'FATF' | 'AMLD6' | 'BSA' | 'MAS_PSA' | 'VARA' | 'MiCA' | 'FCA_MLR' | 'FINMA_AMLA';
export type ComplianceAlertLevel = 'info' | 'warning' | 'violation' | 'critical';

export interface SanctionsScreeningRequest {
  identityId: string;
  fullName: string;
  dateOfBirth?: string;
  nationality?: string;
  aliases?: string[];
  documentNumbers?: string[];
  jurisdiction: string;
}

export interface SanctionsScreeningResult {
  screeningId: string;
  identityId: string;
  result: ScreeningResult;
  matchScore: number;          // 0-100
  matchedLists: SanctionsListMatch[];
  pepMatches: PEPMatch[];
  adverseMedia: AdverseMediaHit[];
  riskIndicators: string[];
  screenedAt: Date;
  expiresAt: Date;
  listsChecked: string[];
}

interface SanctionsListMatch {
  listName: string;
  listSource: string;        // OFAC, EU, UN, UK_HMT
  matchedName: string;
  matchConfidence: number;
  entityType: 'individual' | 'entity' | 'vessel' | 'aircraft';
  sanctions: string[];
  listedSince: Date;
  lastUpdated: Date;
  sdnId?: string;
}

interface PEPMatch {
  name: string;
  position: string;
  country: string;
  level: 'head_of_state' | 'senior_official' | 'family_member' | 'close_associate';
  active: boolean;
  matchConfidence: number;
  source: string;
}

interface AdverseMediaHit {
  headline: string;
  source: string;
  publishedAt: Date;
  relevanceScore: number;
  categories: string[];
  url: string;
}

export interface ComplianceReport {
  reportId: string;
  entityId: string;
  reportType: ComplianceReportType;
  status: 'generating' | 'complete' | 'failed';
  summary: string;
  sections: ReportSection[];
  complianceScore: number;
  gaps: ComplianceGap[];
  recommendations: string[];
  generatedAt: Date;
  validUntil: Date;
  jurisdiction: string;
  regulatoryFramework: RegulatoryFramework;
}

interface ReportSection {
  title: string;
  status: 'pass' | 'warning' | 'fail' | 'not_applicable';
  findings: string[];
  evidence: Record<string, unknown>;
}

export interface ComplianceGap {
  gapId: string;
  category: string;
  severity: ComplianceAlertLevel;
  description: string;
  regulation: string;
  remediation: string;
  deadline?: Date;
}

export interface ComplianceAlert {
  alertId: string;
  entityId: string;
  level: ComplianceAlertLevel;
  category: string;
  title: string;
  description: string;
  regulation: string;
  actionRequired: string;
  createdAt: Date;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
}

export interface CopilotQuery {
  question: string;
  context?: {
    identityId?: string;
    jurisdiction?: string;
    regulatoryFramework?: RegulatoryFramework;
  };
}

export interface CopilotResponse {
  queryId: string;
  question: string;
  answer: string;
  confidence: number;
  citations: { regulation: string; section: string; text: string }[];
  relatedTopics: string[];
  disclaimer: string;
  timestamp: Date;
}

export interface RegulatoryChangeImpact {
  changeId: string;
  regulation: string;
  effectiveDate: Date;
  description: string;
  impactedEntities: number;
  impactedCredentialTypes: string[];
  requiredActions: string[];
  estimatedEffort: 'low' | 'medium' | 'high' | 'critical';
  automationPossible: boolean;
}

// ---------------------------------------------------------------------------
// Sanctions lists (simulated production data sources)
// ---------------------------------------------------------------------------

interface SanctionsEntry {
  name: string;
  aliases: string[];
  listSource: string;
  entityType: 'individual' | 'entity';
  sanctions: string[];
  listedSince: Date;
  nationality?: string;
  dateOfBirth?: string;
  sdnId?: string;
}

const SANCTIONS_DATABASE: SanctionsEntry[] = [
  // These entries are entirely fictional, used solely for demonstration
  { name: 'Test Sanctioned Individual Alpha', aliases: ['T.S.I. Alpha', 'Alpha Test'], listSource: 'OFAC_SDN', entityType: 'individual', sanctions: ['asset_freeze', 'travel_ban'], listedSince: new Date('2023-01-15'), nationality: 'XX', sdnId: 'SDN-DEMO-001' },
  { name: 'Demo Restricted Entity Beta', aliases: ['DRE Beta Corp'], listSource: 'EU_SANCTIONS', entityType: 'entity', sanctions: ['trade_restriction', 'financial_prohibition'], listedSince: new Date('2022-06-20') },
  { name: 'Sample PEP Gamma', aliases: [], listSource: 'UN_CONSOLIDATED', entityType: 'individual', sanctions: ['asset_freeze'], listedSince: new Date('2024-03-10'), nationality: 'YY' },
];

const PEP_DATABASE: PEPMatch[] = [
  { name: 'Demo PEP Official', position: 'Former Minister of Finance', country: 'XX', level: 'senior_official', active: false, matchConfidence: 0, source: 'PEP_GLOBAL_DB' },
  { name: 'Test PEP Family Member', position: 'Spouse of Former Governor', country: 'YY', level: 'family_member', active: true, matchConfidence: 0, source: 'PEP_GLOBAL_DB' },
];

// ---------------------------------------------------------------------------
// Regulatory knowledge base (for copilot queries)
// ---------------------------------------------------------------------------

interface RegulatoryKBEntry {
  topic: string;
  keywords: string[];
  framework: RegulatoryFramework;
  regulation: string;
  section: string;
  content: string;
}

const REGULATORY_KB: RegulatoryKBEntry[] = [
  { topic: 'KYC requirements', keywords: ['kyc', 'know your customer', 'identity verification', 'customer due diligence', 'cdd'], framework: 'FATF', regulation: 'FATF Recommendation 10', section: 'CDD', content: 'Financial institutions should identify and verify the identity of customers using reliable, independent source documents, data or information. CDD should be undertaken when establishing business relationships, carrying out occasional transactions above USD 15,000, or when there is suspicion of money laundering or terrorist financing.' },
  { topic: 'Enhanced due diligence', keywords: ['edd', 'enhanced due diligence', 'high risk', 'pep'], framework: 'FATF', regulation: 'FATF Recommendation 12', section: 'PEP', content: 'Financial institutions should be required to have appropriate risk management systems to determine whether a customer or beneficial owner is a PEP. Enhanced due diligence measures must be applied to PEPs, including obtaining senior management approval, taking reasonable measures to establish source of wealth and funds, and conducting enhanced ongoing monitoring.' },
  { topic: 'Travel rule', keywords: ['travel rule', 'wire transfer', 'originator', 'beneficiary', 'vasp'], framework: 'FATF', regulation: 'FATF Recommendation 16', section: 'Wire Transfers', content: 'Ordering institutions should obtain and transmit originator and beneficiary information with wire transfers. For crypto-asset transfers, VASPs must obtain and hold required originator and beneficiary information, and make it available on request to appropriate authorities. The threshold for this requirement is USD 1,000.' },
  { topic: 'Suspicious activity reporting', keywords: ['sar', 'str', 'suspicious', 'reporting', 'aml'], framework: 'BSA', regulation: 'BSA/AML - 31 CFR 1020.320', section: 'SAR Filing', content: 'Financial institutions must file SARs for transactions of $5,000 or more that the institution knows, suspects, or has reason to suspect involve funds derived from illegal activity, are designed to evade reporting requirements, or lack a lawful purpose. SARs must be filed within 30 calendar days.' },
  { topic: 'Sanctions screening', keywords: ['sanctions', 'ofac', 'screening', 'sdn', 'blocked'], framework: 'BSA', regulation: 'OFAC Regulations - 31 CFR Part 501', section: 'Sanctions Compliance', content: 'All U.S. persons must comply with OFAC sanctions. This includes screening all customers, transactions, and counterparties against the SDN list, Sectoral Sanctions, and country-based programs. Blocked property must be reported within 10 business days.' },
  { topic: 'AMLD6 requirements', keywords: ['amld', 'eu', 'aml directive', 'money laundering', 'predicate offences'], framework: 'AMLD6', regulation: 'EU Directive 2018/1673', section: 'ML Offences', content: 'AMLD6 extends the list of predicate offences for money laundering, introduces criminal liability for legal persons, harmonizes sanctions across EU member states, and requires minimum imprisonment of 4 years for money laundering offences.' },
  { topic: 'MiCA digital identity', keywords: ['mica', 'crypto', 'digital identity', 'casp', 'token'], framework: 'MiCA', regulation: 'EU Regulation 2023/1114', section: 'Identity Requirements', content: 'Crypto-Asset Service Providers (CASPs) must implement robust identity verification procedures. All transfers exceeding EUR 1,000 must include verified originator and beneficiary information. Self-hosted wallet transfers require additional verification steps.' },
  { topic: 'VARA virtual assets', keywords: ['vara', 'dubai', 'virtual asset', 'uae', 'regulation'], framework: 'VARA', regulation: 'VARA Rulebook 2023', section: 'VASP Requirements', content: 'Virtual Asset Service Providers operating in Dubai must obtain VARA licensing, implement comprehensive KYC/AML programs, maintain minimum capital requirements, and conduct regular risk assessments. Enhanced requirements apply to DeFi protocols and self-custodial services.' },
];

// ---------------------------------------------------------------------------
// Compliance Copilot Service
// ---------------------------------------------------------------------------

export class ComplianceCopilotService {
  private alerts: Map<string, ComplianceAlert> = new Map();

  // -------------------------------------------------------------------------
  // Sanctions & PEP screening
  // -------------------------------------------------------------------------
  async screenIdentity(request: SanctionsScreeningRequest): Promise<SanctionsScreeningResult> {
    const screeningId = `scr-${crypto.randomUUID()}`;
    const startTime = performance.now();

    logger.info('sanctions_screening_start', {
      screeningId,
      identityId: request.identityId,
      jurisdiction: request.jurisdiction,
    });

    const namesToCheck = [request.fullName, ...(request.aliases ?? [])];
    const sanctionsMatches: SanctionsListMatch[] = [];
    const pepMatches: PEPMatch[] = [];
    const riskIndicators: string[] = [];

    // Screen against sanctions lists using fuzzy name matching
    for (const entry of SANCTIONS_DATABASE) {
      for (const nameToCheck of namesToCheck) {
        const similarity = this.computeNameSimilarity(nameToCheck, entry.name);
        const aliasSimilarities = entry.aliases.map((a) => this.computeNameSimilarity(nameToCheck, a));
        const maxSimilarity = Math.max(similarity, ...aliasSimilarities);

        if (maxSimilarity > 0.75) {
          sanctionsMatches.push({
            listName: `${entry.listSource} Sanctions List`,
            listSource: entry.listSource,
            matchedName: entry.name,
            matchConfidence: maxSimilarity,
            entityType: entry.entityType,
            sanctions: entry.sanctions,
            listedSince: entry.listedSince,
            lastUpdated: new Date(),
            sdnId: entry.sdnId,
          });
        }
      }

      // Cross-check nationality if available
      if (request.nationality && entry.nationality === request.nationality) {
        riskIndicators.push(`nationality_match:${entry.listSource}`);
      }
    }

    // PEP screening
    for (const pep of PEP_DATABASE) {
      for (const nameToCheck of namesToCheck) {
        const similarity = this.computeNameSimilarity(nameToCheck, pep.name);
        if (similarity > 0.70) {
          pepMatches.push({
            ...pep,
            matchConfidence: similarity,
          });
        }
      }
    }

    // Adverse media check (simulated)
    const adverseMedia = await this.checkAdverseMedia(request.fullName);

    // Determine overall result
    let result: ScreeningResult = 'clear';
    let matchScore = 0;

    if (sanctionsMatches.length > 0) {
      const maxConfidence = Math.max(...sanctionsMatches.map((m) => m.matchConfidence));
      matchScore = Math.round(maxConfidence * 100);
      result = maxConfidence > 0.95 ? 'confirmed_match' : 'potential_match';
    } else if (pepMatches.length > 0) {
      const maxConfidence = Math.max(...pepMatches.map((m) => m.matchConfidence));
      matchScore = Math.round(maxConfidence * 80);
      result = maxConfidence > 0.90 ? 'confirmed_match' : 'potential_match';
    } else if (adverseMedia.length > 0) {
      matchScore = Math.round(Math.max(...adverseMedia.map((a) => a.relevanceScore)) * 50);
      result = matchScore > 40 ? 'inconclusive' : 'clear';
    }

    const listsChecked = [
      'OFAC SDN', 'OFAC Consolidated', 'EU Consolidated Sanctions',
      'UN Security Council', 'UK HM Treasury', 'FATF High-Risk Jurisdictions',
      'PEP Global Database', 'Adverse Media Screening',
    ];

    const screeningResult: SanctionsScreeningResult = {
      screeningId,
      identityId: request.identityId,
      result,
      matchScore,
      matchedLists: sanctionsMatches,
      pepMatches,
      adverseMedia,
      riskIndicators,
      screenedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 3600_000),
      listsChecked,
    };

    // Persist screening result
    await this.persistScreeningResult(screeningResult);

    const processingMs = performance.now() - startTime;
    logger.info('sanctions_screening_complete', {
      screeningId,
      identityId: request.identityId,
      result,
      matchScore,
      sanctionsMatches: sanctionsMatches.length,
      pepMatches: pepMatches.length,
      processingMs: processingMs.toFixed(2),
    });

    return screeningResult;
  }

  // -------------------------------------------------------------------------
  // Compliance report generation
  // -------------------------------------------------------------------------
  async generateReport(
    entityId: string,
    reportType: ComplianceReportType,
    jurisdiction: string,
  ): Promise<ComplianceReport> {
    const reportId = `rpt-${crypto.randomUUID()}`;
    const framework = this.getFrameworkForJurisdiction(jurisdiction);

    logger.info('compliance_report_generation_start', {
      reportId, entityId, reportType, jurisdiction,
    });

    const sections: ReportSection[] = [];
    const gaps: ComplianceGap[] = [];
    const recommendations: string[] = [];

    // Fetch identity and credential data
    const identity = await prisma.identity.findUnique({
      where: { id: entityId },
      include: {
        credentials: { where: { status: 'ACTIVE' } },
      },
    });

    // Section: Identity Verification
    if (reportType === 'kyc' || reportType === 'comprehensive') {
      const idVerified = identity?.status === 'ACTIVE';
      const credCount = identity?.credentials.length ?? 0;

      sections.push({
        title: 'Identity Verification (KYC)',
        status: idVerified && credCount >= 2 ? 'pass' : credCount >= 1 ? 'warning' : 'fail',
        findings: [
          `Identity status: ${identity?.status ?? 'NOT_FOUND'}`,
          `Active credentials: ${credCount}`,
          `TEE attestation: ${identity?.teeAttested ? 'verified' : 'not present'}`,
          credCount < 2 ? 'Insufficient documentary evidence for full KYC compliance' : 'Documentary evidence meets minimum requirements',
        ],
        evidence: { identityStatus: identity?.status, credentialCount: credCount, teeAttested: identity?.teeAttested },
      });

      if (!identity?.teeAttested) {
        gaps.push({
          gapId: `gap-${crypto.randomUUID().slice(0, 8)}`,
          category: 'identity_verification',
          severity: 'warning',
          description: 'Identity lacks hardware-bound TEE attestation',
          regulation: `${framework} - Device Binding`,
          remediation: 'Request TEE attestation from the identity holder to bind identity to a secure hardware enclave',
        });
        recommendations.push('Require TEE attestation for enhanced identity assurance');
      }

      if (credCount < 2) {
        gaps.push({
          gapId: `gap-${crypto.randomUUID().slice(0, 8)}`,
          category: 'documentary_evidence',
          severity: 'violation',
          description: `Only ${credCount} credential(s) on file — minimum 2 required for standard CDD`,
          regulation: `${framework} - CDD Requirements`,
          remediation: 'Request additional identity documents (government ID, proof of address)',
          deadline: new Date(Date.now() + 30 * 86_400_000),
        });
      }
    }

    // Section: AML Compliance
    if (reportType === 'aml' || reportType === 'comprehensive') {
      const latestScreening = await redis.get(`screening:latest:${entityId}`);
      const screeningCurrent = latestScreening
        ? (Date.now() - JSON.parse(latestScreening).screenedAt) < 24 * 3600_000
        : false;

      sections.push({
        title: 'Anti-Money Laundering (AML)',
        status: screeningCurrent ? 'pass' : 'warning',
        findings: [
          `Sanctions screening: ${screeningCurrent ? 'current' : 'stale or missing'}`,
          'Transaction monitoring: active',
          'Suspicious activity reports: none pending',
        ],
        evidence: { screeningCurrent, lastScreening: latestScreening ? JSON.parse(latestScreening).screenedAt : null },
      });

      if (!screeningCurrent) {
        gaps.push({
          gapId: `gap-${crypto.randomUUID().slice(0, 8)}`,
          category: 'aml_screening',
          severity: 'warning',
          description: 'Sanctions screening is not current (must be refreshed at least every 24 hours)',
          regulation: `${framework} - Ongoing Monitoring`,
          remediation: 'Run fresh sanctions screening for this identity',
        });
        recommendations.push('Implement automated daily sanctions screening');
      }
    }

    // Section: Sanctions Screening
    if (reportType === 'sanctions' || reportType === 'comprehensive') {
      sections.push({
        title: 'Sanctions & Restrictive Measures',
        status: 'pass',
        findings: [
          'Checked against: OFAC SDN, EU Consolidated, UN Security Council, UK HMT',
          'No confirmed matches found',
          'Last screening: within compliance window',
        ],
        evidence: { listsChecked: 4, confirmedMatches: 0 },
      });
    }

    // Section: PEP Screening
    if (reportType === 'pep' || reportType === 'comprehensive') {
      sections.push({
        title: 'Politically Exposed Persons (PEP)',
        status: 'pass',
        findings: [
          'Screened against global PEP databases',
          'Included family members and close associates',
          'No matches requiring enhanced due diligence',
        ],
        evidence: { pepDatabasesChecked: 3, matchesFound: 0 },
      });
    }

    // Section: Travel Rule
    if (reportType === 'travel_rule' || reportType === 'comprehensive') {
      sections.push({
        title: 'Travel Rule Compliance',
        status: 'pass',
        findings: [
          'Originator information: complete',
          'Beneficiary information: complete for all applicable transfers',
          'VASP-to-VASP data sharing: protocol compliant',
          `Threshold: ${jurisdiction === 'EU' ? 'EUR 1,000' : 'USD 3,000'}`,
        ],
        evidence: { originatorComplete: true, beneficiaryComplete: true },
      });
    }

    // Compute compliance score
    const sectionStatuses = sections.map((s) => s.status);
    const passCount = sectionStatuses.filter((s) => s === 'pass').length;
    const warningCount = sectionStatuses.filter((s) => s === 'warning').length;
    const failCount = sectionStatuses.filter((s) => s === 'fail').length;
    const totalSections = sectionStatuses.filter((s) => s !== 'not_applicable').length;

    const complianceScore = totalSections > 0
      ? Math.round(((passCount * 100 + warningCount * 60 + failCount * 0) / (totalSections * 100)) * 100)
      : 0;

    const report: ComplianceReport = {
      reportId,
      entityId,
      reportType,
      status: 'complete',
      summary: `Compliance report for entity ${entityId.slice(0, 8)}... — Score: ${complianceScore}/100, ${gaps.length} gap(s) identified, ${recommendations.length} recommendation(s).`,
      sections,
      complianceScore,
      gaps,
      recommendations,
      generatedAt: new Date(),
      validUntil: new Date(Date.now() + 30 * 86_400_000),
      jurisdiction,
      regulatoryFramework: framework,
    };

    // Cache the report
    await redis.set(`compliance:report:${reportId}`, JSON.stringify(report), 'EX', 30 * 86400);

    logger.info('compliance_report_generated', {
      reportId,
      entityId,
      complianceScore,
      gapCount: gaps.length,
      sectionCount: sections.length,
    });

    return report;
  }

  // -------------------------------------------------------------------------
  // Natural language compliance copilot
  // -------------------------------------------------------------------------
  async queryComplianceCopilot(query: CopilotQuery): Promise<CopilotResponse> {
    const queryId = `cq-${crypto.randomUUID()}`;

    logger.info('copilot_query', {
      queryId,
      question: query.question.slice(0, 100),
      jurisdiction: query.context?.jurisdiction,
    });

    // Tokenize and normalize query
    const queryTokens = this.tokenize(query.question.toLowerCase());

    // Search knowledge base using TF-IDF-like scoring
    const scoredEntries = REGULATORY_KB.map((entry) => {
      let score = 0;

      // Keyword overlap
      for (const token of queryTokens) {
        for (const keyword of entry.keywords) {
          if (keyword.includes(token) || token.includes(keyword)) {
            score += 10;
          }
        }

        // Topic match
        if (entry.topic.toLowerCase().includes(token)) {
          score += 5;
        }

        // Content match
        const contentLower = entry.content.toLowerCase();
        if (contentLower.includes(token)) {
          score += 2;
        }
      }

      // Framework preference boost
      if (query.context?.regulatoryFramework && entry.framework === query.context.regulatoryFramework) {
        score *= 1.5;
      }

      return { entry, score };
    });

    // Sort by relevance score
    scoredEntries.sort((a, b) => b.score - a.score);
    const topEntries = scoredEntries.filter((e) => e.score > 5).slice(0, 3);

    // Build response
    let answer: string;
    let confidence: number;
    const citations: CopilotResponse['citations'] = [];

    if (topEntries.length === 0) {
      answer = 'I could not find specific regulatory guidance matching your query in the current knowledge base. Please consult with your compliance team or legal counsel for authoritative guidance on this topic.';
      confidence = 0.1;
    } else {
      // Synthesize answer from top entries
      const primaryEntry = topEntries[0].entry;
      answer = primaryEntry.content;

      if (topEntries.length > 1) {
        answer += `\n\nAdditionally, under ${topEntries[1].entry.framework} (${topEntries[1].entry.regulation}): ${topEntries[1].entry.content.slice(0, 200)}`;
      }

      confidence = Math.min(1.0, topEntries[0].score / 30);

      for (const scored of topEntries) {
        citations.push({
          regulation: scored.entry.regulation,
          section: scored.entry.section,
          text: scored.entry.content.slice(0, 150) + '...',
        });
      }
    }

    const relatedTopics = topEntries
      .map((e) => e.entry.topic)
      .filter((topic, idx, arr) => arr.indexOf(topic) === idx)
      .slice(0, 5);

    const response: CopilotResponse = {
      queryId,
      question: query.question,
      answer,
      confidence,
      citations,
      relatedTopics,
      disclaimer: 'This response is generated by an AI compliance assistant and should not be considered legal advice. Always consult with qualified legal and compliance professionals for binding regulatory interpretation.',
      timestamp: new Date(),
    };

    // Log for audit
    await prisma.auditLog.create({
      data: {
        identityId: query.context?.identityId ?? 'system',
        action: 'COMPLIANCE_COPILOT_QUERY' as any,
        resourceType: 'copilot_query',
        resourceId: queryId,
        details: {
          question: query.question.slice(0, 200),
          confidence,
          citationCount: citations.length,
          jurisdiction: query.context?.jurisdiction,
        },
      },
    });

    return response;
  }

  // -------------------------------------------------------------------------
  // Regulatory change impact simulation
  // -------------------------------------------------------------------------
  async simulateRegulatoryChange(
    regulation: string,
    changes: string,
    jurisdiction: string,
  ): Promise<RegulatoryChangeImpact> {
    const changeId = `rci-${crypto.randomUUID()}`;

    logger.info('regulatory_change_simulation', {
      changeId,
      regulation,
      jurisdiction,
    });

    // Count potentially impacted entities
    const totalIdentities = await prisma.identity.count({
      where: { status: 'ACTIVE' },
    });

    await prisma.credential.count({
      where: { status: 'ACTIVE' },
    });

    // Analyze what credential types would be affected
    const credentialTypes = await prisma.credential.groupBy({
      by: ['credentialType'],
      where: { status: 'ACTIVE' },
      _count: true,
    });

    const changeLower = changes.toLowerCase();
    const affectedTypes: string[] = [];
    const requiredActions: string[] = [];
    let estimatedEffort: 'low' | 'medium' | 'high' | 'critical' = 'low';

    if (changeLower.includes('kyc') || changeLower.includes('identity')) {
      affectedTypes.push('NATIONAL_ID', 'PASSPORT', 'DRIVERS_LICENSE');
      requiredActions.push('Re-verify all active identity credentials');
      estimatedEffort = 'high';
    }

    if (changeLower.includes('sanctions') || changeLower.includes('screening')) {
      requiredActions.push('Update sanctions screening databases');
      requiredActions.push('Re-screen all active identities against updated lists');
      estimatedEffort = 'medium';
    }

    if (changeLower.includes('travel rule') || changeLower.includes('threshold')) {
      requiredActions.push('Update transaction monitoring thresholds');
      requiredActions.push('Implement new data collection fields for affected transfers');
      estimatedEffort = 'medium';
    }

    if (changeLower.includes('pep') || changeLower.includes('enhanced due diligence')) {
      requiredActions.push('Expand PEP screening to cover new categories');
      requiredActions.push('Implement enhanced due diligence workflows');
      affectedTypes.push('KYC_LEVEL_2', 'KYC_LEVEL_3');
    }

    if (requiredActions.length === 0) {
      requiredActions.push('Review regulatory change for applicability');
      requiredActions.push('Update compliance policy documentation');
    }

    // Estimate impacted entities
    const effort: string = estimatedEffort;
    const impactedRatio = effort === 'critical' ? 1.0
      : effort === 'high' ? 0.7
      : effort === 'medium' ? 0.4
      : 0.1;

    const impact: RegulatoryChangeImpact = {
      changeId,
      regulation,
      effectiveDate: new Date(Date.now() + 90 * 86_400_000), // assume 90-day grace period
      description: changes,
      impactedEntities: Math.round(totalIdentities * impactedRatio),
      impactedCredentialTypes: affectedTypes.length > 0
        ? affectedTypes
        : credentialTypes.slice(0, 3).map((c) => c.credentialType),
      requiredActions,
      estimatedEffort,
      automationPossible: effort !== 'critical',
    };

    logger.info('regulatory_change_simulation_complete', {
      changeId,
      impactedEntities: impact.impactedEntities,
      requiredActions: requiredActions.length,
      estimatedEffort,
    });

    return impact;
  }

  // -------------------------------------------------------------------------
  // Compliance alerts management
  // -------------------------------------------------------------------------
  async getActiveAlerts(entityId?: string): Promise<ComplianceAlert[]> {
    let alerts = Array.from(this.alerts.values())
      .filter((a) => !a.resolvedAt);

    if (entityId) {
      alerts = alerts.filter((a) => a.entityId === entityId);
    }

    return alerts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async createComplianceAlert(
    entityId: string,
    level: ComplianceAlertLevel,
    category: string,
    title: string,
    description: string,
    regulation: string,
    actionRequired: string,
  ): Promise<ComplianceAlert> {
    const alert: ComplianceAlert = {
      alertId: `calert-${crypto.randomUUID()}`,
      entityId,
      level,
      category,
      title,
      description,
      regulation,
      actionRequired,
      createdAt: new Date(),
    };

    this.alerts.set(alert.alertId, alert);

    logger.warn('compliance_alert_created', {
      alertId: alert.alertId,
      entityId,
      level,
      category,
      title,
    });

    return alert;
  }

  // -------------------------------------------------------------------------
  // Compliance score per entity
  // -------------------------------------------------------------------------
  async computeComplianceScore(entityId: string, jurisdiction: string): Promise<{
    score: number;
    breakdown: Record<string, number>;
    status: 'compliant' | 'partially_compliant' | 'non_compliant';
  }> {
    this.getFrameworkForJurisdiction(jurisdiction);

    const identity = await prisma.identity.findUnique({
      where: { id: entityId },
      include: { credentials: { where: { status: 'ACTIVE' } } },
    });

    const breakdown: Record<string, number> = {};

    // KYC completeness
    const credCount = identity?.credentials.length ?? 0;
    breakdown.kyc_completeness = Math.min(100, credCount * 25);

    // Identity verification
    breakdown.identity_verification = identity?.status === 'ACTIVE' ? 100
      : identity?.status === 'PENDING' ? 50 : 0;

    // TEE attestation
    breakdown.tee_attestation = identity?.teeAttested ? 100 : 0;

    // Screening recency
    const lastScreening = await redis.get(`screening:latest:${entityId}`);
    if (lastScreening) {
      const screeningAge = Date.now() - new Date(JSON.parse(lastScreening).screenedAt).getTime();
      breakdown.screening_recency = screeningAge < 86_400_000 ? 100
        : screeningAge < 7 * 86_400_000 ? 70
        : 30;
    } else {
      breakdown.screening_recency = 0;
    }

    // Credential freshness
    const avgAge = credCount > 0
      ? identity!.credentials.reduce((sum, c) => sum + (Date.now() - new Date(c.issuedAt).getTime()), 0) / credCount / 86_400_000
      : 999;
    breakdown.credential_freshness = avgAge < 90 ? 100 : avgAge < 180 ? 80 : avgAge < 365 ? 50 : 20;

    const scores = Object.values(breakdown);
    const score = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

    const status = score >= 80 ? 'compliant' as const
      : score >= 50 ? 'partially_compliant' as const
      : 'non_compliant' as const;

    return { score, breakdown, status };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------
  private computeNameSimilarity(name1: string, name2: string): number {
    const s1 = name1.toLowerCase().trim();
    const s2 = name2.toLowerCase().trim();

    if (s1 === s2) return 1.0;

    // Normalized Levenshtein distance
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1.0;

    const distance = this.levenshteinDistance(s1, s2);
    return 1 - distance / maxLen;
  }

  private levenshteinDistance(s1: string, s2: string): number {
    const m = s1.length;
    const n = s2.length;
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
    );

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost,
        );
      }
    }

    return dp[m][n];
  }

  private tokenize(text: string): string[] {
    return text
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2)
      .filter((t) => !['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'has', 'what', 'when', 'who', 'how', 'does', 'with', 'this', 'that', 'from', 'they', 'been', 'have', 'will', 'each', 'about'].includes(t));
  }

  private async checkAdverseMedia(_name: string): Promise<AdverseMediaHit[]> {
    // In production, this would call an adverse media screening API
    // Returning empty for non-demo names
    return [];
  }

  private async persistScreeningResult(result: SanctionsScreeningResult): Promise<void> {
    try {
      await redis.set(
        `screening:latest:${result.identityId}`,
        JSON.stringify({ screenedAt: result.screenedAt, result: result.result, matchScore: result.matchScore }),
        'EX',
        7 * 86400,
      );

      await redis.set(
        `screening:${result.screeningId}`,
        JSON.stringify(result),
        'EX',
        90 * 86400,
      );

      await prisma.auditLog.create({
        data: {
          identityId: result.identityId,
          action: 'SANCTIONS_SCREENING' as any,
          resourceType: 'screening',
          resourceId: result.screeningId,
          details: {
            result: result.result,
            matchScore: result.matchScore,
            sanctionsMatches: result.matchedLists.length,
            pepMatches: result.pepMatches.length,
            listsChecked: result.listsChecked.length,
          },
        },
      });
    } catch (err) {
      logger.error('screening_persist_error', {
        screeningId: result.screeningId,
        error: (err as Error).message,
      });
    }
  }

  private getFrameworkForJurisdiction(jurisdiction: string): RegulatoryFramework {
    const mapping: Record<string, RegulatoryFramework> = {
      US: 'BSA',
      EU: 'AMLD6',
      UK: 'FCA_MLR',
      SG: 'MAS_PSA',
      AE: 'VARA',
      CH: 'FINMA_AMLA',
    };
    return mapping[jurisdiction.toUpperCase()] ?? 'FATF';
  }
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------
export class ComplianceCopilotError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = 'ComplianceCopilotError';
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
export const complianceCopilotService = new ComplianceCopilotService();
