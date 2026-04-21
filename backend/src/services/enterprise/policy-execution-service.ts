import { prisma } from '../../index';
import { ComplianceEvaluationRequest, ComplianceStatus, CrossBorderAssessment, CrossBorderResult } from '../compliance/jurisdiction-engine';
import { BatchScreeningRequest, ScreeningRequest, ScreeningResult } from '../compliance/sanctions-screening';
import { BreachNotification, BreachTimeline, CrossBorderTransfer, PIA, PIAResult, TransferAssessmentResult } from '../compliance/data-sovereignty';
import { GeneratedReport } from '../compliance/regulatory-reporting';
import { PolicyExecutionContext } from './policy-context-service';

type PolicyDecision = 'allow' | 'review_required' | 'blocked';
type ExecutionSeverity = 'warning' | 'fail';

interface ComplianceExecutionDefinition {
  additionalRequiredCredentialsByOperation?: Record<string, string[]>;
  hardFailureCredentialTypes?: string[];
  credentialFreshnessMaxAgeDays?: number;
  credentialFreshnessSeverity?: ExecutionSeverity;
  requireTrustedIssuerForCredentialTypes?: string[];
  acceptedIssuerAssuranceLevels?: string[];
  forcePendingReviewOnWarnings?: boolean;
}

interface ScreeningExecutionDefinition {
  requiredListSources?: string[];
  forceReviewOnPepMatches?: boolean;
  reviewRiskLevels?: Array<ScreeningResult['overallRisk']>;
  blockEntityTypes?: Array<ScreeningRequest['entityType']>;
  minimumPotentialMatchScore?: number;
}

interface BatchScreeningExecutionDefinition {
  maximumBatchSize?: number;
  maxConfirmedMatchesBeforeReview?: number;
  forceReviewOnPriorities?: Array<BatchScreeningRequest['priority']>;
}

interface CrossBorderExecutionDefinition {
  prohibitedJurisdictionPairs?: string[];
  disallowedDataCategories?: string[];
  requiredLegalBases?: string[];
  requiredSafeguards?: string[];
  blockedTransferMechanisms?: Array<CrossBorderResult['dataTransferMechanism']>;
  forceReviewOnRiskLevels?: Array<TransferAssessmentResult['riskLevel']>;
}

interface ReportingExecutionDefinition {
  forcePendingReviewForReportTypes?: string[];
  requiredRequestFieldsByReportType?: Record<string, string[]>;
  forcePendingReviewOnPriorities?: string[];
}

interface PrivacyExecutionDefinition {
  forcePendingReviewOnRequestTypes?: string[];
  requiredDataCategoriesByRequestType?: Record<string, string[]>;
  requireRetentionOverridesForErasureCategories?: string[];
  forceSupervisoryConsultationRiskLevels?: Array<PIAResult['riskLevel']>;
  requireProcessorDpas?: boolean;
  forcePendingReviewOnCrossBorderPIA?: boolean;
  forceSubjectNotificationSeverities?: Array<BreachNotification['severity']>;
  acceleratedBreachDeadlineHours?: number;
}

interface PolicyRecord {
  id: string;
  name: string;
  version: string;
  definition: unknown;
}

export interface PolicyExecutionTrace {
  policyDefinitionId: string;
  policyName: string;
  policyVersion: string;
  directives: string[];
  jurisdictionAdjustments?: Array<{
    jurisdiction: string;
    changes: string[];
  }>;
  screeningAdjustments?: Array<{
    entityId: string;
    changes: string[];
  }>;
  batchAdjustments?: Array<{
    batchId: string;
    changes: string[];
  }>;
  crossBorderAdjustments?: Array<{
    source: string;
    target: string;
    changes: string[];
  }>;
  reportingAdjustments?: Array<{
    reportType: string;
    changes: string[];
  }>;
  privacyAdjustments?: Array<{
    operation: string;
    changes: string[];
  }>;
}

export interface CompliancePolicyExecutionResult {
  results: ComplianceStatus[];
  trace?: PolicyExecutionTrace;
}

export type ScreeningPolicyAdjustedResult = ScreeningResult & {
  policyAlerts?: string[];
  policyDecision?: PolicyDecision;
};

export interface ScreeningPolicyExecutionResult {
  result: ScreeningPolicyAdjustedResult;
  trace?: PolicyExecutionTrace;
}

export interface BatchScreeningPolicyAdjustedResult {
  batchId: string;
  totalEntities: number;
  results: ScreeningResult[];
  summary: { clear: number; potentialMatch: number; confirmedMatch: number };
  processingTimeMs: number;
  policyAlerts?: string[];
  policyDecision?: PolicyDecision;
}

export interface BatchScreeningPolicyExecutionResult {
  result: BatchScreeningPolicyAdjustedResult;
  trace?: PolicyExecutionTrace;
}

export type CrossBorderPolicyAdjustedResult = (CrossBorderResult | TransferAssessmentResult) & {
  policyAlerts?: string[];
  policyDecision?: PolicyDecision;
};

export interface CrossBorderPolicyExecutionResult {
  result: CrossBorderPolicyAdjustedResult;
  trace?: PolicyExecutionTrace;
}

export type ReportingPolicyAdjustedResult = GeneratedReport & {
  policyAlerts?: string[];
  policyDecision?: PolicyDecision;
};

export interface ReportingPolicyExecutionResult {
  result: ReportingPolicyAdjustedResult;
  trace?: PolicyExecutionTrace;
}

export type PrivacyWorkflowAdjustedResult = (GeneratedReport | PIAResult | BreachTimeline) & {
  policyAlerts?: string[];
  policyDecision?: PolicyDecision;
};

export interface PrivacyWorkflowPolicyExecutionResult {
  result: PrivacyWorkflowAdjustedResult;
  trace?: PolicyExecutionTrace;
}

export class PolicyExecutionService {
  async applyCompliancePolicy(
    organizationId: string,
    policyContext: PolicyExecutionContext,
    request: ComplianceEvaluationRequest,
    results: ComplianceStatus[],
  ): Promise<CompliancePolicyExecutionResult> {
    const policyRecord = await this.getPolicyRecord(organizationId, policyContext);
    const execution = this.extractExecutionDefinition<ComplianceExecutionDefinition>(policyRecord?.definition);
    if (!policyRecord || !execution) {
      return { results };
    }

    const presentedCredentialTypes = new Set(request.credentials.map((credential) => credential.credentialType));
    const trustedAnchors = policyContext.trustContext?.anchors ?? [];
    const trustedCredentialTypes = new Set(
      trustedAnchors
        .filter((anchor) => anchor.accepted)
        .flatMap((anchor) => anchor.evaluatedCredentialTypes),
    );
    const acceptedAssuranceLevels = new Set(
      (execution.acceptedIssuerAssuranceLevels ?? []).map((level) => level.toLowerCase()),
    );

    const adjustedResults = results.map((result) => {
      const nextMissingCredentials = [...result.missingCredentials];
      const nextRules = [...result.rules];
      const changes: string[] = [];
      let nextStatus = result.overallStatus;

      const additionalRequired = execution.additionalRequiredCredentialsByOperation?.[request.operationType] ?? [];
      const policyMissing = additionalRequired.filter((credentialType) => !presentedCredentialTypes.has(credentialType));
      for (const credentialType of policyMissing) {
        if (!nextMissingCredentials.includes(credentialType)) {
          nextMissingCredentials.push(credentialType);
        }
      }
      if (policyMissing.length > 0) {
        nextRules.push({
          ruleId: `policy-required-${result.jurisdiction}`,
          name: 'Policy Additional Credentials',
          status: 'fail',
          detail: `Policy requires additional credentials: ${policyMissing.join(', ')}`,
        });
        changes.push(`missing_credentials:${policyMissing.join('|')}`);
      }

      const hardFailureTypes = execution.hardFailureCredentialTypes ?? [];
      const hardFailures = hardFailureTypes.filter((credentialType) => nextMissingCredentials.includes(credentialType));
      if (hardFailures.length > 0) {
        nextRules.push({
          ruleId: `policy-hard-failure-${result.jurisdiction}`,
          name: 'Policy Hard Failure Credentials',
          status: 'fail',
          detail: `Critical credentials missing under policy: ${hardFailures.join(', ')}`,
        });
        changes.push(`hard_failure:${hardFailures.join('|')}`);
      }

      if (execution.credentialFreshnessMaxAgeDays && execution.credentialFreshnessMaxAgeDays > 0) {
        const maxAgeMs = execution.credentialFreshnessMaxAgeDays * 24 * 60 * 60 * 1000;
        const staleCredentials = request.credentials
          .filter((credential) => Date.now() - new Date(credential.issuedAt).getTime() > maxAgeMs)
          .map((credential) => credential.credentialType);
        if (staleCredentials.length > 0) {
          const severity = execution.credentialFreshnessSeverity ?? 'warning';
          nextRules.push({
            ruleId: `policy-freshness-${result.jurisdiction}`,
            name: 'Policy Credential Freshness',
            status: severity === 'fail' ? 'fail' : 'warning',
            detail: `Credentials exceed policy freshness window (${execution.credentialFreshnessMaxAgeDays} days): ${staleCredentials.join(', ')}`,
          });
          changes.push(`freshness_${severity}:${staleCredentials.join('|')}`);
        }
      }

      const trustedTypes = execution.requireTrustedIssuerForCredentialTypes ?? [];
      const untrustedTypes = trustedTypes.filter((credentialType) =>
        presentedCredentialTypes.has(credentialType) && !trustedCredentialTypes.has(credentialType),
      );
      if (untrustedTypes.length > 0) {
        nextRules.push({
          ruleId: `policy-trusted-issuer-${result.jurisdiction}`,
          name: 'Policy Trusted Issuer Requirement',
          status: 'fail',
          detail: `Policy requires trusted issuer coverage for credentials: ${untrustedTypes.join(', ')}`,
        });
        changes.push(`untrusted_issuer:${untrustedTypes.join('|')}`);
      }

      if (acceptedAssuranceLevels.size > 0 && trustedTypes.length > 0) {
        const insufficientAssurance = trustedAnchors
          .filter((anchor) => anchor.accepted)
          .filter((anchor) => anchor.evaluatedCredentialTypes.some((credentialType) => trustedTypes.includes(credentialType)))
          .filter((anchor) => !acceptedAssuranceLevels.has((anchor.assuranceLevel ?? '').toLowerCase()))
          .map((anchor) => anchor.issuerIdentityId);
        if (insufficientAssurance.length > 0) {
          nextRules.push({
            ruleId: `policy-assurance-${result.jurisdiction}`,
            name: 'Policy Issuer Assurance Threshold',
            status: 'fail',
            detail: `Trusted issuers do not meet policy assurance threshold: ${insufficientAssurance.join(', ')}`,
          });
          changes.push(`assurance_failure:${insufficientAssurance.join('|')}`);
        }
      }

      const hasPolicyFailure = nextRules.some((rule) => rule.ruleId.startsWith('policy-') && rule.status === 'fail');
      const hasPolicyWarning = nextRules.some((rule) => rule.ruleId.startsWith('policy-') && rule.status === 'warning');

      if (hasPolicyFailure) {
        nextStatus = 'non_compliant';
      } else if (hasPolicyWarning && execution.forcePendingReviewOnWarnings && nextStatus === 'compliant') {
        nextStatus = 'pending_review';
      }

      return {
        result: {
          ...result,
          overallStatus: nextStatus,
          missingCredentials: nextMissingCredentials,
          rules: nextRules,
        },
        changes,
      };
    });

    const jurisdictionAdjustments = adjustedResults
      .filter((entry) => entry.changes.length > 0)
      .map((entry) => ({
        jurisdiction: entry.result.jurisdiction,
        changes: entry.changes,
      }));

    if (jurisdictionAdjustments.length === 0) {
      return {
        results: adjustedResults.map((entry) => entry.result),
      };
    }

    return {
      results: adjustedResults.map((entry) => entry.result),
      trace: this.buildTrace(policyRecord, this.describeComplianceDirectives(execution), {
        jurisdictionAdjustments,
      }),
    };
  }

  async applyScreeningPolicy(
    organizationId: string,
    policyContext: PolicyExecutionContext,
    request: ScreeningRequest,
    result: ScreeningResult,
  ): Promise<ScreeningPolicyExecutionResult> {
    const policyRecord = await this.getPolicyRecord(organizationId, policyContext);
    const execution = this.extractExecutionDefinition<ScreeningExecutionDefinition>(policyRecord?.definition);
    if (!policyRecord || !execution) {
      return { result };
    }

    const alerts: string[] = [];
    const changes: string[] = [];
    let nextDecision: PolicyDecision = 'allow';
    let nextOverallRisk = result.overallRisk;

    const requiredListSources = execution.requiredListSources ?? [];
    const missingLists = requiredListSources.filter((source) => !result.listsScreened.includes(source));
    if (missingLists.length > 0) {
      alerts.push(`Required screening lists were not covered: ${missingLists.join(', ')}`);
      changes.push(`missing_lists:${missingLists.join('|')}`);
      nextDecision = this.maxDecision(nextDecision, 'review_required');
      if (nextOverallRisk === 'clear') {
        nextOverallRisk = 'potential_match';
      }
    }

    if ((execution.blockEntityTypes ?? []).includes(request.entityType)) {
      alerts.push(`Policy blocks screening disposition for entity type ${request.entityType}`);
      changes.push(`blocked_entity_type:${request.entityType}`);
      nextDecision = this.maxDecision(nextDecision, 'blocked');
    }

    if (execution.forceReviewOnPepMatches) {
      const activePepMatches = result.matches.filter((match) => match.listSource === 'pep_database' && match.status !== 'false_positive');
      if (activePepMatches.length > 0) {
        alerts.push('Policy requires manual review for politically exposed person matches');
        changes.push(`pep_review:${activePepMatches.length}`);
        nextDecision = this.maxDecision(nextDecision, 'review_required');
        if (nextOverallRisk === 'clear') {
          nextOverallRisk = 'potential_match';
        }
      }
    }

    if ((execution.reviewRiskLevels ?? []).includes(result.overallRisk)) {
      alerts.push(`Policy requires additional review for ${result.overallRisk} screening outcomes`);
      changes.push(`risk_review:${result.overallRisk}`);
      nextDecision = this.maxDecision(nextDecision, 'review_required');
    }

    if (execution.minimumPotentialMatchScore) {
      const thresholdMatches = result.matches.filter(
        (match) => match.status !== 'false_positive' && match.matchScore >= execution.minimumPotentialMatchScore!,
      );
      if (thresholdMatches.length > 0 && nextOverallRisk === 'clear') {
        alerts.push(`Policy elevated the screening for match scores >= ${execution.minimumPotentialMatchScore}`);
        changes.push(`score_threshold:${execution.minimumPotentialMatchScore}`);
        nextDecision = this.maxDecision(nextDecision, 'review_required');
        nextOverallRisk = 'potential_match';
      }
    }

    const adjustedResult = this.attachPolicyOutcome(
      {
        ...result,
        overallRisk: nextOverallRisk,
      },
      alerts,
      nextDecision,
    );

    if (changes.length === 0) {
      return { result: adjustedResult };
    }

    return {
      result: adjustedResult,
      trace: this.buildTrace(policyRecord, this.describeScreeningDirectives(execution), {
        screeningAdjustments: [
          {
            entityId: result.entityId,
            changes,
          },
        ],
      }),
    };
  }

  async applyBatchScreeningPolicy(
    organizationId: string,
    policyContext: PolicyExecutionContext,
    request: BatchScreeningRequest,
    result: BatchScreeningPolicyAdjustedResult,
  ): Promise<BatchScreeningPolicyExecutionResult> {
    const policyRecord = await this.getPolicyRecord(organizationId, policyContext);
    const execution = this.extractExecutionDefinition<BatchScreeningExecutionDefinition>(policyRecord?.definition);
    if (!policyRecord || !execution) {
      return { result };
    }

    const alerts: string[] = [];
    const changes: string[] = [];
    let nextDecision: PolicyDecision = 'allow';

    if (execution.maximumBatchSize && request.requests.length > execution.maximumBatchSize) {
      alerts.push(`Policy requires review for batches larger than ${execution.maximumBatchSize} entities`);
      changes.push(`batch_size:${request.requests.length}`);
      nextDecision = this.maxDecision(nextDecision, 'review_required');
    }

    if (
      execution.maxConfirmedMatchesBeforeReview &&
      result.summary.confirmedMatch >= execution.maxConfirmedMatchesBeforeReview
    ) {
      alerts.push(`Policy requires review when confirmed matches reach ${execution.maxConfirmedMatchesBeforeReview}`);
      changes.push(`confirmed_matches:${result.summary.confirmedMatch}`);
      nextDecision = this.maxDecision(nextDecision, 'review_required');
    }

    if ((execution.forceReviewOnPriorities ?? []).includes(request.priority)) {
      alerts.push(`Policy requires manual review for ${request.priority} priority screening batches`);
      changes.push(`priority_review:${request.priority}`);
      nextDecision = this.maxDecision(nextDecision, 'review_required');
    }

    const adjustedResult = this.attachPolicyOutcome(result, alerts, nextDecision);
    if (changes.length === 0) {
      return { result: adjustedResult };
    }

    return {
      result: adjustedResult,
      trace: this.buildTrace(policyRecord, this.describeBatchScreeningDirectives(execution), {
        batchAdjustments: [
          {
            batchId: result.batchId,
            changes,
          },
        ],
      }),
    };
  }

  async applyCrossBorderPolicy(
    organizationId: string,
    policyContext: PolicyExecutionContext,
    request: CrossBorderAssessment | CrossBorderTransfer,
    result: CrossBorderResult | TransferAssessmentResult,
  ): Promise<CrossBorderPolicyExecutionResult> {
    const policyRecord = await this.getPolicyRecord(organizationId, policyContext);
    const execution = this.extractExecutionDefinition<CrossBorderExecutionDefinition>(policyRecord?.definition);
    if (!policyRecord || !execution) {
      return { result };
    }

    const alerts: string[] = [];
    const changes: string[] = [];
    let nextDecision: PolicyDecision = 'allow';
    let nextAllowed = result.allowed;

    const source = request.sourceJurisdiction;
    const target = request.targetJurisdiction;
    const pair = `${source}->${target}`.toLowerCase();
    const prohibitedPairs = new Set((execution.prohibitedJurisdictionPairs ?? []).map((value) => value.toLowerCase()));
    if (prohibitedPairs.has(pair)) {
      alerts.push(`Policy prohibits transfers from ${source} to ${target}`);
      changes.push(`prohibited_pair:${source}->${target}`);
      nextDecision = this.maxDecision(nextDecision, 'blocked');
      nextAllowed = false;
    }

    const requestCategories = this.extractDataCategories(request);
    const disallowedCategories = (execution.disallowedDataCategories ?? []).filter((category) => requestCategories.includes(category));
    if (disallowedCategories.length > 0) {
      alerts.push(`Policy disallows transferring categories: ${disallowedCategories.join(', ')}`);
      changes.push(`disallowed_categories:${disallowedCategories.join('|')}`);
      nextDecision = this.maxDecision(nextDecision, 'blocked');
      nextAllowed = false;
    }

    const requestLegalBasis = this.extractLegalBasis(request, result);
    const requiredLegalBases = execution.requiredLegalBases ?? [];
    if (requiredLegalBases.length > 0 && !requestLegalBasis) {
      alerts.push(`Policy requires one of the following legal bases: ${requiredLegalBases.join(', ')}`);
      changes.push('legal_basis:missing');
      nextDecision = this.maxDecision(nextDecision, 'blocked');
      nextAllowed = false;
    }
    if (requiredLegalBases.length > 0 && requestLegalBasis && !requiredLegalBases.includes(requestLegalBasis)) {
      alerts.push(`Policy requires legal basis ${requiredLegalBases.join(', ')} for this transfer`);
      changes.push(`legal_basis:${requestLegalBasis}`);
      nextDecision = this.maxDecision(nextDecision, 'blocked');
      nextAllowed = false;
    }

    if ('dataTransferMechanism' in result && (execution.blockedTransferMechanisms ?? []).includes(result.dataTransferMechanism)) {
      alerts.push(`Policy blocks transfer mechanism ${result.dataTransferMechanism}`);
      changes.push(`blocked_mechanism:${result.dataTransferMechanism}`);
      nextDecision = this.maxDecision(nextDecision, 'blocked');
      nextAllowed = false;
    }

    if ('riskLevel' in result && (execution.forceReviewOnRiskLevels ?? []).includes(result.riskLevel)) {
      alerts.push(`Policy requires manual review for ${result.riskLevel} risk transfer assessments`);
      changes.push(`risk_review:${result.riskLevel}`);
      nextDecision = this.maxDecision(nextDecision, 'review_required');
    }

    const missingSafeguards = this.extractMissingSafeguards(result, execution.requiredSafeguards ?? []);
    if (missingSafeguards.length > 0) {
      alerts.push(`Policy requires additional safeguards: ${missingSafeguards.join(', ')}`);
      changes.push(`required_safeguards:${missingSafeguards.join('|')}`);
      nextDecision = this.maxDecision(nextDecision, 'review_required');
    }

    const adjustedResult = this.attachPolicyOutcome(
      this.mergeCrossBorderAdjustments(result, {
        allowed: nextAllowed,
        alerts,
        requiredSafeguards: execution.requiredSafeguards ?? [],
      }),
      alerts,
      nextDecision,
    );

    if (changes.length === 0) {
      return { result: adjustedResult };
    }

    return {
      result: adjustedResult,
      trace: this.buildTrace(policyRecord, this.describeCrossBorderDirectives(execution), {
        crossBorderAdjustments: [
          {
            source,
            target,
            changes,
          },
        ],
      }),
    };
  }

  async applyReportingPolicy(
    organizationId: string,
    policyContext: PolicyExecutionContext,
    request: Record<string, unknown>,
    report: GeneratedReport,
  ): Promise<ReportingPolicyExecutionResult> {
    const policyRecord = await this.getPolicyRecord(organizationId, policyContext);
    const execution = this.extractExecutionDefinition<ReportingExecutionDefinition>(policyRecord?.definition);
    if (!policyRecord || !execution) {
      return { result: report };
    }

    const alerts: string[] = [];
    const changes: string[] = [];
    let nextDecision: PolicyDecision = 'allow';
    let nextStatus = report.status;

    const reportType = String(report.reportType ?? request.reportType ?? 'UNKNOWN');
    if ((execution.forcePendingReviewForReportTypes ?? []).includes(reportType)) {
      alerts.push(`Policy requires pending review for ${reportType} reports`);
      changes.push(`pending_review:${reportType}`);
      nextDecision = this.maxDecision(nextDecision, 'review_required');
      nextStatus = 'pending_review';
    }

    const requiredFields = execution.requiredRequestFieldsByReportType?.[reportType] ?? [];
    const missingFields = requiredFields.filter((field) => !this.hasNestedValue(request, field));
    if (missingFields.length > 0) {
      alerts.push(`Policy requires additional report inputs: ${missingFields.join(', ')}`);
      changes.push(`missing_fields:${missingFields.join('|')}`);
      nextDecision = this.maxDecision(nextDecision, 'review_required');
      nextStatus = 'pending_review';
    }

    const priority = typeof request.priority === 'string' ? request.priority : null;
    if (priority && (execution.forcePendingReviewOnPriorities ?? []).includes(priority)) {
      alerts.push(`Policy requires pending review for ${priority} priority reports`);
      changes.push(`priority_review:${priority}`);
      nextDecision = this.maxDecision(nextDecision, 'review_required');
      nextStatus = 'pending_review';
    }

    const adjustedResult = this.attachPolicyOutcome(
      {
        ...report,
        status: nextStatus,
      },
      alerts,
      nextDecision,
    );

    if (changes.length === 0) {
      return { result: adjustedResult };
    }

    return {
      result: adjustedResult,
      trace: this.buildTrace(policyRecord, this.describeReportingDirectives(execution), {
        reportingAdjustments: [
          {
            reportType,
            changes,
          },
        ],
      }),
    };
  }

  async applyPrivacyWorkflowPolicy(
    organizationId: string,
    policyContext: PolicyExecutionContext,
    operation: 'dsar' | 'erasure' | 'pia' | 'breach',
    request: Record<string, unknown> | PIA | BreachNotification,
    result: GeneratedReport | PIAResult | BreachTimeline,
  ): Promise<PrivacyWorkflowPolicyExecutionResult> {
    const policyRecord = await this.getPolicyRecord(organizationId, policyContext);
    const execution = this.extractExecutionDefinition<PrivacyExecutionDefinition>(policyRecord?.definition);
    if (!policyRecord || !execution) {
      return { result };
    }

    const alerts: string[] = [];
    const changes: string[] = [];
    let nextDecision: PolicyDecision = 'allow';

    if (operation === 'dsar' || operation === 'erasure') {
      const report = result as GeneratedReport;
      const requestType = String((request as Record<string, unknown>).requestType ?? operation);
      let nextStatus = report.status;

      if ((execution.forcePendingReviewOnRequestTypes ?? []).includes(requestType)) {
        alerts.push(`Policy requires pending review for ${requestType} privacy requests`);
        changes.push(`request_type_review:${requestType}`);
        nextDecision = this.maxDecision(nextDecision, 'review_required');
        nextStatus = 'pending_review';
      }

      const requestedCategories = Array.isArray((request as Record<string, unknown>).dataCategories)
        ? ((request as Record<string, unknown>).dataCategories as unknown[]).map((entry) => String(entry))
        : [];
      const requiredCategories = execution.requiredDataCategoriesByRequestType?.[requestType] ?? [];
      const missingCategories = requiredCategories.filter((category) => !requestedCategories.includes(category));
      if (missingCategories.length > 0) {
        alerts.push(`Policy requires additional privacy request categories: ${missingCategories.join(', ')}`);
        changes.push(`missing_categories:${missingCategories.join('|')}`);
        nextDecision = this.maxDecision(nextDecision, 'review_required');
        nextStatus = 'pending_review';
      }

      if (operation === 'erasure') {
        const retentionOverrides = Array.isArray((request as Record<string, unknown>).retentionOverrides)
          ? ((request as Record<string, unknown>).retentionOverrides as Array<Record<string, unknown>>)
          : [];
        const overrideCategories = new Set(
          retentionOverrides
            .map((entry) => String(entry.category ?? ''))
            .filter((value) => value.length > 0),
        );
        const requiredOverrides = (execution.requireRetentionOverridesForErasureCategories ?? [])
          .filter((category) => requestedCategories.includes(category))
          .filter((category) => !overrideCategories.has(category));
        if (requiredOverrides.length > 0) {
          alerts.push(`Policy requires retention overrides for erasure categories: ${requiredOverrides.join(', ')}`);
          changes.push(`missing_retention_overrides:${requiredOverrides.join('|')}`);
          nextDecision = this.maxDecision(nextDecision, 'review_required');
          nextStatus = 'pending_review';
        }
      }

      const adjustedReport = this.attachPolicyOutcome(
        {
          ...report,
          status: nextStatus,
        },
        alerts,
        nextDecision,
      );

      if (changes.length === 0) {
        return { result: adjustedReport };
      }

      return {
        result: adjustedReport,
        trace: this.buildTrace(policyRecord, this.describePrivacyDirectives(execution), {
          privacyAdjustments: [
            {
              operation,
              changes,
            },
          ],
        }),
      };
    }

    if (operation === 'pia') {
      const piaResult = result as PIAResult;
      const piaRequest = request as PIA;
      const nextRecommendations = [...piaResult.recommendations];
      const nextFindings = [...piaResult.findings];
      let nextSupervisoryConsultationRequired = piaResult.supervisoryConsultationRequired;

      if ((execution.forceSupervisoryConsultationRiskLevels ?? []).includes(piaResult.riskLevel) && !nextSupervisoryConsultationRequired) {
        alerts.push(`Policy requires supervisory consultation for ${piaResult.riskLevel} risk PIAs`);
        changes.push(`supervisory_consultation:${piaResult.riskLevel}`);
        nextDecision = this.maxDecision(nextDecision, 'review_required');
        nextSupervisoryConsultationRequired = true;
        nextRecommendations.push('Escalate to supervisory authority review under policy control');
      }

      if (execution.requireProcessorDpas && piaRequest.thirdPartyProcessors.some((processor) => !processor.dpaInPlace)) {
        alerts.push('Policy requires signed DPAs for all third-party processors');
        changes.push('missing_dpa:true');
        nextDecision = this.maxDecision(nextDecision, 'review_required');
        nextFindings.push({
          area: 'Policy Processor Governance',
          risk: 'One or more processors lack signed data processing agreements',
          severity: 'high',
          mitigation: 'Complete DPA execution before proceeding under sovereign policy controls.',
        });
      }

      if (execution.forcePendingReviewOnCrossBorderPIA && piaRequest.crossBorderTransfer) {
        alerts.push('Policy requires review for PIAs involving cross-border transfers');
        changes.push('cross_border_pia:true');
        nextDecision = this.maxDecision(nextDecision, 'review_required');
        nextRecommendations.push('Route this PIA through cross-border review board before launch');
      }

      const adjustedPia = this.attachPolicyOutcome(
        {
          ...piaResult,
          findings: nextFindings,
          supervisoryConsultationRequired: nextSupervisoryConsultationRequired,
          recommendations: [...new Set(nextRecommendations)],
        },
        alerts,
        nextDecision,
      );

      if (changes.length === 0) {
        return { result: adjustedPia };
      }

      return {
        result: adjustedPia,
        trace: this.buildTrace(policyRecord, this.describePrivacyDirectives(execution), {
          privacyAdjustments: [
            {
              operation,
              changes,
            },
          ],
        }),
      };
    }

    const breachTimeline = result as BreachTimeline;
    const breachRequest = request as BreachNotification;
    let nextDataSubjectNotificationRequired = breachTimeline.dataSubjectNotificationRequired;
    let nextDataSubjectDeadlineHours = breachTimeline.dataSubjectDeadlineHours;
    let nextDeadlines = breachTimeline.regulatoryDeadlines;

    if ((execution.forceSubjectNotificationSeverities ?? []).includes(breachRequest.severity) && !nextDataSubjectNotificationRequired) {
      alerts.push(`Policy requires data subject notification for ${breachRequest.severity} severity breaches`);
      changes.push(`subject_notification:${breachRequest.severity}`);
      nextDecision = this.maxDecision(nextDecision, 'review_required');
      nextDataSubjectNotificationRequired = true;
      nextDataSubjectDeadlineHours = nextDataSubjectDeadlineHours > 0 ? nextDataSubjectDeadlineHours : 72;
    }

    if (execution.acceleratedBreachDeadlineHours && execution.acceleratedBreachDeadlineHours > 0) {
      const accelerated: typeof breachTimeline.regulatoryDeadlines = [];
      let acceleratedAny = false;
      for (const deadline of breachTimeline.regulatoryDeadlines) {
        if (deadline.deadlineHours > execution.acceleratedBreachDeadlineHours) {
          acceleratedAny = true;
          changes.push(`accelerated_deadline:${deadline.jurisdiction}`);
          accelerated.push({
            ...deadline,
            deadlineHours: execution.acceleratedBreachDeadlineHours,
            deadline: new Date(new Date(breachRequest.detectedAt).getTime() + execution.acceleratedBreachDeadlineHours * 60 * 60 * 1000).toISOString(),
          });
        } else {
          accelerated.push(deadline);
        }
      }

      if (acceleratedAny) {
        alerts.push(`Policy accelerates breach escalation to ${execution.acceleratedBreachDeadlineHours} hours for one or more jurisdictions`);
        nextDecision = this.maxDecision(nextDecision, 'review_required');
        nextDeadlines = accelerated;
      }
    }

    const adjustedBreach = this.attachPolicyOutcome(
      {
        ...breachTimeline,
        regulatoryDeadlines: nextDeadlines,
        dataSubjectNotificationRequired: nextDataSubjectNotificationRequired,
        dataSubjectDeadlineHours: nextDataSubjectDeadlineHours,
      },
      alerts,
      nextDecision,
    );

    if (changes.length === 0) {
      return { result: adjustedBreach };
    }

    return {
      result: adjustedBreach,
      trace: this.buildTrace(policyRecord, this.describePrivacyDirectives(execution), {
        privacyAdjustments: [
          {
            operation,
            changes,
          },
        ],
      }),
    };
  }

  private async getPolicyRecord(
    organizationId: string,
    policyContext: PolicyExecutionContext,
  ): Promise<PolicyRecord | null> {
    if (!policyContext.policyDefinitionId) {
      return null;
    }

    const policyModel = (prisma as any).policyDefinition;
    if (!policyModel?.findFirst) {
      return null;
    }

    return policyModel.findFirst({
      where: {
        id: policyContext.policyDefinitionId,
        organizationId,
      },
      select: {
        id: true,
        name: true,
        version: true,
        definition: true,
      },
    });
  }

  private extractExecutionDefinition<T>(definition: unknown): T | null {
    if (!definition || typeof definition !== 'object') {
      return null;
    }

    const execution = (definition as Record<string, unknown>).execution;
    if (!execution || typeof execution !== 'object') {
      return null;
    }

    return execution as T;
  }

  private buildTrace(
    policyRecord: PolicyRecord,
    directives: string[],
    fields: Omit<PolicyExecutionTrace, 'policyDefinitionId' | 'policyName' | 'policyVersion' | 'directives'>,
  ): PolicyExecutionTrace {
    return {
      policyDefinitionId: policyRecord.id,
      policyName: policyRecord.name,
      policyVersion: policyRecord.version,
      directives,
      ...fields,
    };
  }

  private describeComplianceDirectives(execution: ComplianceExecutionDefinition): string[] {
    const directives: string[] = [];
    if (execution.additionalRequiredCredentialsByOperation && Object.keys(execution.additionalRequiredCredentialsByOperation).length > 0) {
      directives.push('additional_required_credentials');
    }
    if ((execution.hardFailureCredentialTypes ?? []).length > 0) {
      directives.push('hard_failure_credentials');
    }
    if (execution.credentialFreshnessMaxAgeDays) {
      directives.push('credential_freshness_window');
    }
    if ((execution.requireTrustedIssuerForCredentialTypes ?? []).length > 0) {
      directives.push('trusted_issuer_requirement');
    }
    if ((execution.acceptedIssuerAssuranceLevels ?? []).length > 0) {
      directives.push('issuer_assurance_threshold');
    }
    if (execution.forcePendingReviewOnWarnings) {
      directives.push('force_pending_review_on_warnings');
    }
    return directives;
  }

  private describeScreeningDirectives(execution: ScreeningExecutionDefinition): string[] {
    const directives: string[] = [];
    if ((execution.requiredListSources ?? []).length > 0) {
      directives.push('required_screening_lists');
    }
    if (execution.forceReviewOnPepMatches) {
      directives.push('pep_review_requirement');
    }
    if ((execution.reviewRiskLevels ?? []).length > 0) {
      directives.push('screening_risk_review_levels');
    }
    if ((execution.blockEntityTypes ?? []).length > 0) {
      directives.push('entity_type_blocklist');
    }
    if (execution.minimumPotentialMatchScore) {
      directives.push('potential_match_score_threshold');
    }
    return directives;
  }

  private describeBatchScreeningDirectives(execution: BatchScreeningExecutionDefinition): string[] {
    const directives: string[] = [];
    if (execution.maximumBatchSize) {
      directives.push('maximum_batch_size');
    }
    if (execution.maxConfirmedMatchesBeforeReview) {
      directives.push('confirmed_match_review_threshold');
    }
    if ((execution.forceReviewOnPriorities ?? []).length > 0) {
      directives.push('priority_review_gate');
    }
    return directives;
  }

  private describeCrossBorderDirectives(execution: CrossBorderExecutionDefinition): string[] {
    const directives: string[] = [];
    if ((execution.prohibitedJurisdictionPairs ?? []).length > 0) {
      directives.push('prohibited_jurisdiction_pairs');
    }
    if ((execution.disallowedDataCategories ?? []).length > 0) {
      directives.push('disallowed_data_categories');
    }
    if ((execution.requiredLegalBases ?? []).length > 0) {
      directives.push('required_legal_basis');
    }
    if ((execution.requiredSafeguards ?? []).length > 0) {
      directives.push('required_safeguards');
    }
    if ((execution.blockedTransferMechanisms ?? []).length > 0) {
      directives.push('blocked_transfer_mechanisms');
    }
    if ((execution.forceReviewOnRiskLevels ?? []).length > 0) {
      directives.push('risk_review_levels');
    }
    return directives;
  }

  private describeReportingDirectives(execution: ReportingExecutionDefinition): string[] {
    const directives: string[] = [];
    if ((execution.forcePendingReviewForReportTypes ?? []).length > 0) {
      directives.push('pending_review_report_types');
    }
    if (execution.requiredRequestFieldsByReportType && Object.keys(execution.requiredRequestFieldsByReportType).length > 0) {
      directives.push('required_request_fields');
    }
    if ((execution.forcePendingReviewOnPriorities ?? []).length > 0) {
      directives.push('priority_review_gate');
    }
    return directives;
  }

  private describePrivacyDirectives(execution: PrivacyExecutionDefinition): string[] {
    const directives: string[] = [];
    if ((execution.forcePendingReviewOnRequestTypes ?? []).length > 0) {
      directives.push('privacy_request_review_gate');
    }
    if (execution.requiredDataCategoriesByRequestType && Object.keys(execution.requiredDataCategoriesByRequestType).length > 0) {
      directives.push('required_privacy_data_categories');
    }
    if ((execution.requireRetentionOverridesForErasureCategories ?? []).length > 0) {
      directives.push('required_retention_overrides');
    }
    if ((execution.forceSupervisoryConsultationRiskLevels ?? []).length > 0) {
      directives.push('supervisory_consultation_risk_levels');
    }
    if (execution.requireProcessorDpas) {
      directives.push('processor_dpa_requirement');
    }
    if (execution.forcePendingReviewOnCrossBorderPIA) {
      directives.push('cross_border_pia_review_gate');
    }
    if ((execution.forceSubjectNotificationSeverities ?? []).length > 0) {
      directives.push('breach_subject_notification_gate');
    }
    if (execution.acceleratedBreachDeadlineHours) {
      directives.push('accelerated_breach_deadlines');
    }
    return directives;
  }

  private attachPolicyOutcome<T extends Record<string, unknown>>(
    result: T,
    alerts: string[],
    decision: PolicyDecision,
  ): T {
    return {
      ...result,
      ...(alerts.length > 0 ? { policyAlerts: alerts } : {}),
      ...(decision !== 'allow' ? { policyDecision: decision } : {}),
    };
  }

  private maxDecision(current: PolicyDecision, next: PolicyDecision): PolicyDecision {
    const ordering: Record<PolicyDecision, number> = {
      allow: 0,
      review_required: 1,
      blocked: 2,
    };

    return ordering[next] > ordering[current] ? next : current;
  }

  private extractDataCategories(request: CrossBorderAssessment | CrossBorderTransfer): string[] {
    if ('dataCategories' in request && Array.isArray(request.dataCategories)) {
      return request.dataCategories.map((category) => String(category));
    }
    return [];
  }

  private extractLegalBasis(
    request: CrossBorderAssessment | CrossBorderTransfer,
    result: CrossBorderResult | TransferAssessmentResult,
  ): string | null {
    if ('legalBasis' in result) {
      return result.legalBasis;
    }
    if ('legalBasis' in request) {
      return request.legalBasis ?? null;
    }
    if ('dataTransferMechanism' in result) {
      return result.dataTransferMechanism;
    }
    return null;
  }

  private mergeCrossBorderAdjustments(
    result: CrossBorderResult | TransferAssessmentResult,
    input: {
      allowed: boolean;
      alerts: string[];
      requiredSafeguards: string[];
    },
  ): CrossBorderResult | TransferAssessmentResult {
    if ('requiredSafeguards' in result && 'conditions' in result) {
      const missingSafeguards = input.requiredSafeguards.filter((safeguard) => !result.requiredSafeguards.includes(safeguard));
      return {
        ...result,
        allowed: input.allowed,
        requiredSafeguards: [...result.requiredSafeguards, ...missingSafeguards],
        conditions: [...result.conditions, ...input.alerts],
        riskLevel: input.allowed ? result.riskLevel : 'prohibited',
      };
    }

    return {
      ...result,
      allowed: input.allowed,
      restrictions: [...result.restrictions, ...input.alerts],
    };
  }

  private extractMissingSafeguards(
    result: CrossBorderResult | TransferAssessmentResult,
    requiredSafeguards: string[],
  ): string[] {
    if (!('requiredSafeguards' in result)) {
      return [];
    }

    return requiredSafeguards.filter((safeguard) => !result.requiredSafeguards.includes(safeguard));
  }

  private hasNestedValue(input: Record<string, unknown>, path: string): boolean {
    const segments = path.split('.');
    let cursor: unknown = input;
    for (const segment of segments) {
      if (!cursor || typeof cursor !== 'object' || !(segment in (cursor as Record<string, unknown>))) {
        return false;
      }
      cursor = (cursor as Record<string, unknown>)[segment];
    }

    if (cursor === null || cursor === undefined) {
      return false;
    }

    if (typeof cursor === 'string') {
      return cursor.trim().length > 0;
    }

    if (Array.isArray(cursor)) {
      return cursor.length > 0;
    }

    return true;
  }
}

export const policyExecutionService = new PolicyExecutionService();
