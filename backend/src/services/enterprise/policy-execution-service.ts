import { prisma } from '../../runtime';
import {
  ComplianceEvaluationRequest,
  ComplianceStatus,
  CrossBorderAssessment,
  CrossBorderResult,
} from '../compliance/jurisdiction-engine';
import {
  BatchScreeningRequest,
  ScreeningRequest,
  ScreeningResult,
} from '../compliance/sanctions-screening';
import {
  BreachNotification,
  BreachTimeline,
  CrossBorderTransfer,
  PIA,
  PIAResult,
  TransferAssessmentResult,
} from '../compliance/data-sovereignty';
import { GeneratedReport } from '../compliance/regulatory-reporting';
import { PolicyExecutionContext } from './policy-context-service';
import { policyGovernanceService } from './policy-governance-service';

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
  forceReviewOnPriorities?: Array<BatchScreeningRequest['priority'] | 'urgent'>;
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

export interface GovernanceOverlayTrace {
  packId: string;
  packVersion?: string;
  packLabel?: string;
  directives: string[];
  appliedDirectives?: string[];
}

export interface PolicyExecutionTrace {
  policyDefinitionId: string;
  policyName: string;
  policyVersion: string;
  directives: string[];
  governanceOverlay?: GovernanceOverlayTrace;
  runtimeGuard?: {
    code: 'governance_pack_definition_invalid';
    packId: string;
    reason: string;
  };
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

export type CrossBorderPolicyAdjustedResult = (
  | CrossBorderResult
  | TransferAssessmentResult
) & {
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

export type PrivacyWorkflowAdjustedResult = (
  | GeneratedReport
  | PIAResult
  | BreachTimeline
) & {
  policyAlerts?: string[];
  policyDecision?: PolicyDecision;
};

export interface PrivacyWorkflowPolicyExecutionResult {
  result: PrivacyWorkflowAdjustedResult;
  trace?: PolicyExecutionTrace;
}

interface ResolvedExecutionDefinition<T> {
  execution: T | null;
  governanceOverlay?: GovernanceOverlayTrace;
}

export class PolicyExecutionService {
  async applyCompliancePolicy(
    organizationId: string,
    policyContext: PolicyExecutionContext,
    request: ComplianceEvaluationRequest,
    results: ComplianceStatus[],
  ): Promise<CompliancePolicyExecutionResult> {
    const policyRecord = await this.getPolicyRecord(
      organizationId,
      policyContext,
    );
    const runtimeGuard = this.buildRuntimeGuard(policyRecord, policyContext);
    if (policyRecord && runtimeGuard) {
      return {
        results: results.map((result) => ({
          ...result,
          overallStatus: 'non_compliant',
          rules: [
            ...result.rules,
            {
              ruleId: `policy-runtime-guard-${result.jurisdiction}`,
              name: 'Policy Governance Runtime Guard',
              status: 'fail',
              detail: runtimeGuard.reason,
            },
          ],
        })),
        trace: this.buildTrace(
          policyRecord,
          ['governance_pack_runtime_guard'],
          {
            runtimeGuard,
            jurisdictionAdjustments: results.map((result) => ({
              jurisdiction: result.jurisdiction,
              changes: [`runtime_guard:${runtimeGuard.packId}`],
            })),
          },
        ),
      };
    }
    const resolved = this.resolveComplianceExecutionDefinition(
      this.extractExecutionDefinition<ComplianceExecutionDefinition>(
        policyRecord?.definition,
      ),
      policyContext,
    );
    const execution = resolved.execution;
    if (!policyRecord || !execution) {
      return { results };
    }
    const appliedOverlayDirectives = new Set<string>();

    const presentedCredentialTypes = new Set(
      request.credentials.map((credential) => credential.credentialType),
    );
    const trustedAnchors = policyContext.trustContext?.anchors ?? [];
    const trustedCredentialTypes = new Set(
      trustedAnchors
        .filter((anchor) => anchor.accepted)
        .flatMap((anchor) => anchor.evaluatedCredentialTypes),
    );
    const acceptedAssuranceLevels = new Set(
      (execution.acceptedIssuerAssuranceLevels ?? []).map((level) =>
        level.toLowerCase(),
      ),
    );

    const adjustedResults = results.map((result) => {
      const nextMissingCredentials = [...result.missingCredentials];
      const nextRules = [...result.rules];
      const changes: string[] = [];
      let nextStatus = result.overallStatus;

      const additionalRequired =
        execution.additionalRequiredCredentialsByOperation?.[
          request.operationType
        ] ?? [];
      const policyMissing = additionalRequired.filter(
        (credentialType) => !presentedCredentialTypes.has(credentialType),
      );
      for (const credentialType of policyMissing) {
        if (!nextMissingCredentials.includes(credentialType)) {
          nextMissingCredentials.push(credentialType);
        }
      }
      if (policyMissing.length > 0) {
        this.markOverlayDirectiveApplied(
          appliedOverlayDirectives,
          resolved.governanceOverlay,
          'additional_required_credentials',
        );
        nextRules.push({
          ruleId: `policy-required-${result.jurisdiction}`,
          name: 'Policy Additional Credentials',
          status: 'fail',
          detail: `Policy requires additional credentials: ${policyMissing.join(', ')}`,
        });
        changes.push(`missing_credentials:${policyMissing.join('|')}`);
      }

      const hardFailureTypes = execution.hardFailureCredentialTypes ?? [];
      const hardFailures = hardFailureTypes.filter((credentialType) =>
        nextMissingCredentials.includes(credentialType),
      );
      if (hardFailures.length > 0) {
        this.markOverlayDirectiveApplied(
          appliedOverlayDirectives,
          resolved.governanceOverlay,
          'hard_failure_credentials',
        );
        nextRules.push({
          ruleId: `policy-hard-failure-${result.jurisdiction}`,
          name: 'Policy Hard Failure Credentials',
          status: 'fail',
          detail: `Critical credentials missing under policy: ${hardFailures.join(', ')}`,
        });
        changes.push(`hard_failure:${hardFailures.join('|')}`);
      }

      if (
        execution.credentialFreshnessMaxAgeDays &&
        execution.credentialFreshnessMaxAgeDays > 0
      ) {
        const maxAgeMs =
          execution.credentialFreshnessMaxAgeDays * 24 * 60 * 60 * 1000;
        const staleCredentials = request.credentials
          .filter(
            (credential) =>
              Date.now() - new Date(credential.issuedAt).getTime() > maxAgeMs,
          )
          .map((credential) => credential.credentialType);
        if (staleCredentials.length > 0) {
          this.markOverlayDirectiveApplied(
            appliedOverlayDirectives,
            resolved.governanceOverlay,
            'credential_freshness_window',
          );
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

      const trustedTypes =
        execution.requireTrustedIssuerForCredentialTypes ?? [];
      const untrustedTypes = trustedTypes.filter(
        (credentialType) =>
          presentedCredentialTypes.has(credentialType) &&
          !trustedCredentialTypes.has(credentialType),
      );
      if (untrustedTypes.length > 0) {
        this.markOverlayDirectiveApplied(
          appliedOverlayDirectives,
          resolved.governanceOverlay,
          'trusted_issuer_requirement',
        );
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
          .filter((anchor) =>
            anchor.evaluatedCredentialTypes.some((credentialType) =>
              trustedTypes.includes(credentialType),
            ),
          )
          .filter(
            (anchor) =>
              !acceptedAssuranceLevels.has(
                (anchor.assuranceLevel ?? '').toLowerCase(),
              ),
          )
          .map((anchor) => anchor.issuerIdentityId);
        if (insufficientAssurance.length > 0) {
          this.markOverlayDirectiveApplied(
            appliedOverlayDirectives,
            resolved.governanceOverlay,
            'issuer_assurance_threshold',
          );
          nextRules.push({
            ruleId: `policy-assurance-${result.jurisdiction}`,
            name: 'Policy Issuer Assurance Threshold',
            status: 'fail',
            detail: `Trusted issuers do not meet policy assurance threshold: ${insufficientAssurance.join(', ')}`,
          });
          changes.push(`assurance_failure:${insufficientAssurance.join('|')}`);
        }
      }

      const hasPolicyFailure = nextRules.some(
        (rule) => rule.ruleId.startsWith('policy-') && rule.status === 'fail',
      );
      const hasPolicyWarning = nextRules.some(
        (rule) =>
          rule.ruleId.startsWith('policy-') && rule.status === 'warning',
      );

      if (hasPolicyFailure) {
        nextStatus = 'non_compliant';
      } else if (
        hasPolicyWarning &&
        execution.forcePendingReviewOnWarnings &&
        nextStatus === 'compliant'
      ) {
        this.markOverlayDirectiveApplied(
          appliedOverlayDirectives,
          resolved.governanceOverlay,
          'force_pending_review_on_warnings',
        );
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
      trace: this.buildTrace(
        policyRecord,
        this.describeComplianceDirectives(execution),
        {
          jurisdictionAdjustments,
        },
        resolved.governanceOverlay,
        appliedOverlayDirectives,
      ),
    };
  }

  async applyScreeningPolicy(
    organizationId: string,
    policyContext: PolicyExecutionContext,
    request: ScreeningRequest,
    result: ScreeningResult,
  ): Promise<ScreeningPolicyExecutionResult> {
    const policyRecord = await this.getPolicyRecord(
      organizationId,
      policyContext,
    );
    const runtimeGuard = this.buildRuntimeGuard(policyRecord, policyContext);
    if (policyRecord && runtimeGuard) {
      return {
        result: this.attachPolicyOutcome(
          result,
          [runtimeGuard.reason],
          'blocked',
        ),
        trace: this.buildTrace(
          policyRecord,
          ['governance_pack_runtime_guard'],
          {
            runtimeGuard,
            screeningAdjustments: [
              {
                entityId: result.entityId,
                changes: [`runtime_guard:${runtimeGuard.packId}`],
              },
            ],
          },
        ),
      };
    }
    const resolved = this.resolveScreeningExecutionDefinition(
      this.extractExecutionDefinition<ScreeningExecutionDefinition>(
        policyRecord?.definition,
      ),
      policyContext,
    );
    const execution = resolved.execution;
    if (!policyRecord || !execution) {
      return { result };
    }

    const alerts: string[] = [];
    const changes: string[] = [];
    let nextDecision: PolicyDecision = 'allow';
    let nextOverallRisk = result.overallRisk;
    const appliedOverlayDirectives = new Set<string>();

    const requiredListSources = execution.requiredListSources ?? [];
    const missingLists = requiredListSources.filter(
      (source) => !result.listsScreened.includes(source),
    );
    if (missingLists.length > 0) {
      this.markOverlayDirectiveApplied(
        appliedOverlayDirectives,
        resolved.governanceOverlay,
        'required_screening_lists',
      );
      alerts.push(
        `Required screening lists were not covered: ${missingLists.join(', ')}`,
      );
      changes.push(`missing_lists:${missingLists.join('|')}`);
      nextDecision = this.maxDecision(nextDecision, 'review_required');
      if (nextOverallRisk === 'clear') {
        nextOverallRisk = 'potential_match';
      }
    }

    if ((execution.blockEntityTypes ?? []).includes(request.entityType)) {
      this.markOverlayDirectiveApplied(
        appliedOverlayDirectives,
        resolved.governanceOverlay,
        'entity_type_blocklist',
      );
      alerts.push(
        `Policy blocks screening disposition for entity type ${request.entityType}`,
      );
      changes.push(`blocked_entity_type:${request.entityType}`);
      nextDecision = this.maxDecision(nextDecision, 'blocked');
    }

    if (execution.forceReviewOnPepMatches) {
      const activePepMatches = result.matches.filter(
        (match) =>
          match.listSource === 'pep_database' &&
          match.status !== 'false_positive',
      );
      if (activePepMatches.length > 0) {
        this.markOverlayDirectiveApplied(
          appliedOverlayDirectives,
          resolved.governanceOverlay,
          'pep_review_requirement',
        );
        alerts.push(
          'Policy requires manual review for politically exposed person matches',
        );
        changes.push(`pep_review:${activePepMatches.length}`);
        nextDecision = this.maxDecision(nextDecision, 'review_required');
        if (nextOverallRisk === 'clear') {
          nextOverallRisk = 'potential_match';
        }
      }
    }

    if ((execution.reviewRiskLevels ?? []).includes(result.overallRisk)) {
      this.markOverlayDirectiveApplied(
        appliedOverlayDirectives,
        resolved.governanceOverlay,
        'screening_risk_review_levels',
      );
      alerts.push(
        `Policy requires additional review for ${result.overallRisk} screening outcomes`,
      );
      changes.push(`risk_review:${result.overallRisk}`);
      nextDecision = this.maxDecision(nextDecision, 'review_required');
    }

    if (execution.minimumPotentialMatchScore) {
      const thresholdMatches = result.matches.filter(
        (match) =>
          match.status !== 'false_positive' &&
          match.matchScore >= execution.minimumPotentialMatchScore!,
      );
      if (thresholdMatches.length > 0 && nextOverallRisk === 'clear') {
        this.markOverlayDirectiveApplied(
          appliedOverlayDirectives,
          resolved.governanceOverlay,
          'potential_match_score_threshold',
        );
        alerts.push(
          `Policy elevated the screening for match scores >= ${execution.minimumPotentialMatchScore}`,
        );
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
      trace: this.buildTrace(
        policyRecord,
        this.describeScreeningDirectives(execution),
        {
          screeningAdjustments: [
            {
              entityId: result.entityId,
              changes,
            },
          ],
        },
        resolved.governanceOverlay,
        appliedOverlayDirectives,
      ),
    };
  }

  async applyBatchScreeningPolicy(
    organizationId: string,
    policyContext: PolicyExecutionContext,
    request: BatchScreeningRequest,
    result: BatchScreeningPolicyAdjustedResult,
  ): Promise<BatchScreeningPolicyExecutionResult> {
    const policyRecord = await this.getPolicyRecord(
      organizationId,
      policyContext,
    );
    const runtimeGuard = this.buildRuntimeGuard(policyRecord, policyContext);
    if (policyRecord && runtimeGuard) {
      return {
        result: this.attachPolicyOutcome(
          result,
          [runtimeGuard.reason],
          'blocked',
        ),
        trace: this.buildTrace(
          policyRecord,
          ['governance_pack_runtime_guard'],
          {
            runtimeGuard,
            batchAdjustments: [
              {
                batchId: result.batchId,
                changes: [`runtime_guard:${runtimeGuard.packId}`],
              },
            ],
          },
        ),
      };
    }
    const resolved = this.resolveBatchScreeningExecutionDefinition(
      this.extractExecutionDefinition<BatchScreeningExecutionDefinition>(
        policyRecord?.definition,
      ),
      policyContext,
    );
    const execution = resolved.execution;
    if (!policyRecord || !execution) {
      return { result };
    }

    const alerts: string[] = [];
    const changes: string[] = [];
    let nextDecision: PolicyDecision = 'allow';
    const appliedOverlayDirectives = new Set<string>();

    if (
      execution.maximumBatchSize &&
      request.requests.length > execution.maximumBatchSize
    ) {
      this.markOverlayDirectiveApplied(
        appliedOverlayDirectives,
        resolved.governanceOverlay,
        'maximum_batch_size',
      );
      alerts.push(
        `Policy requires review for batches larger than ${execution.maximumBatchSize} entities`,
      );
      changes.push(`batch_size:${request.requests.length}`);
      nextDecision = this.maxDecision(nextDecision, 'review_required');
    }

    if (
      execution.maxConfirmedMatchesBeforeReview &&
      result.summary.confirmedMatch >= execution.maxConfirmedMatchesBeforeReview
    ) {
      this.markOverlayDirectiveApplied(
        appliedOverlayDirectives,
        resolved.governanceOverlay,
        'confirmed_match_review_threshold',
      );
      alerts.push(
        `Policy requires review when confirmed matches reach ${execution.maxConfirmedMatchesBeforeReview}`,
      );
      changes.push(`confirmed_matches:${result.summary.confirmedMatch}`);
      nextDecision = this.maxDecision(nextDecision, 'review_required');
    }

    if ((execution.forceReviewOnPriorities ?? []).includes(request.priority)) {
      this.markOverlayDirectiveApplied(
        appliedOverlayDirectives,
        resolved.governanceOverlay,
        'priority_review_gate',
      );
      alerts.push(
        `Policy requires manual review for ${request.priority} priority screening batches`,
      );
      changes.push(`priority_review:${request.priority}`);
      nextDecision = this.maxDecision(nextDecision, 'review_required');
    }

    const adjustedResult = this.attachPolicyOutcome(
      result,
      alerts,
      nextDecision,
    );
    if (changes.length === 0) {
      return { result: adjustedResult };
    }

    return {
      result: adjustedResult,
      trace: this.buildTrace(
        policyRecord,
        this.describeBatchScreeningDirectives(execution),
        {
          batchAdjustments: [
            {
              batchId: result.batchId,
              changes,
            },
          ],
        },
        resolved.governanceOverlay,
        appliedOverlayDirectives,
      ),
    };
  }

  async applyCrossBorderPolicy(
    organizationId: string,
    policyContext: PolicyExecutionContext,
    request: CrossBorderAssessment | CrossBorderTransfer,
    result: CrossBorderResult | TransferAssessmentResult,
  ): Promise<CrossBorderPolicyExecutionResult> {
    const policyRecord = await this.getPolicyRecord(
      organizationId,
      policyContext,
    );
    const runtimeGuard = this.buildRuntimeGuard(policyRecord, policyContext);
    if (policyRecord && runtimeGuard) {
      return {
        result: this.attachPolicyOutcome(
          this.mergeCrossBorderAdjustments(result, {
            allowed: false,
            alerts: [runtimeGuard.reason],
            requiredSafeguards: [],
          }),
          [runtimeGuard.reason],
          'blocked',
        ),
        trace: this.buildTrace(
          policyRecord,
          ['governance_pack_runtime_guard'],
          {
            runtimeGuard,
            crossBorderAdjustments: [
              {
                source: request.sourceJurisdiction,
                target: request.targetJurisdiction,
                changes: [`runtime_guard:${runtimeGuard.packId}`],
              },
            ],
          },
        ),
      };
    }
    const resolved = this.resolveCrossBorderExecutionDefinition(
      this.extractExecutionDefinition<CrossBorderExecutionDefinition>(
        policyRecord?.definition,
      ),
      policyContext,
    );
    const execution = resolved.execution;
    if (!policyRecord || !execution) {
      return { result };
    }

    const alerts: string[] = [];
    const changes: string[] = [];
    let nextDecision: PolicyDecision = 'allow';
    let nextAllowed = result.allowed;
    const appliedOverlayDirectives = new Set<string>();

    const source = request.sourceJurisdiction;
    const target = request.targetJurisdiction;
    const pair = `${source}->${target}`.toLowerCase();
    const prohibitedPairs = new Set(
      (execution.prohibitedJurisdictionPairs ?? []).map((value) =>
        value.toLowerCase(),
      ),
    );
    if (prohibitedPairs.has(pair)) {
      this.markOverlayDirectiveApplied(
        appliedOverlayDirectives,
        resolved.governanceOverlay,
        'prohibited_jurisdiction_pairs',
      );
      alerts.push(`Policy prohibits transfers from ${source} to ${target}`);
      changes.push(`prohibited_pair:${source}->${target}`);
      nextDecision = this.maxDecision(nextDecision, 'blocked');
      nextAllowed = false;
    }

    const requestCategories = this.extractDataCategories(request);
    const disallowedCategories = (
      execution.disallowedDataCategories ?? []
    ).filter((category) => requestCategories.includes(category));
    if (disallowedCategories.length > 0) {
      this.markOverlayDirectiveApplied(
        appliedOverlayDirectives,
        resolved.governanceOverlay,
        'disallowed_data_categories',
      );
      alerts.push(
        `Policy disallows transferring categories: ${disallowedCategories.join(', ')}`,
      );
      changes.push(`disallowed_categories:${disallowedCategories.join('|')}`);
      nextDecision = this.maxDecision(nextDecision, 'blocked');
      nextAllowed = false;
    }

    const requestLegalBasis = this.extractLegalBasis(request, result);
    const requiredLegalBases = execution.requiredLegalBases ?? [];
    if (requiredLegalBases.length > 0 && !requestLegalBasis) {
      this.markOverlayDirectiveApplied(
        appliedOverlayDirectives,
        resolved.governanceOverlay,
        'required_legal_basis',
      );
      alerts.push(
        `Policy requires one of the following legal bases: ${requiredLegalBases.join(', ')}`,
      );
      changes.push('legal_basis:missing');
      nextDecision = this.maxDecision(nextDecision, 'blocked');
      nextAllowed = false;
    }
    if (
      requiredLegalBases.length > 0 &&
      requestLegalBasis &&
      !requiredLegalBases.includes(requestLegalBasis)
    ) {
      this.markOverlayDirectiveApplied(
        appliedOverlayDirectives,
        resolved.governanceOverlay,
        'required_legal_basis',
      );
      alerts.push(
        `Policy requires legal basis ${requiredLegalBases.join(', ')} for this transfer`,
      );
      changes.push(`legal_basis:${requestLegalBasis}`);
      nextDecision = this.maxDecision(nextDecision, 'blocked');
      nextAllowed = false;
    }

    if (
      'dataTransferMechanism' in result &&
      (execution.blockedTransferMechanisms ?? []).includes(
        result.dataTransferMechanism,
      )
    ) {
      this.markOverlayDirectiveApplied(
        appliedOverlayDirectives,
        resolved.governanceOverlay,
        'blocked_transfer_mechanisms',
      );
      alerts.push(
        `Policy blocks transfer mechanism ${result.dataTransferMechanism}`,
      );
      changes.push(`blocked_mechanism:${result.dataTransferMechanism}`);
      nextDecision = this.maxDecision(nextDecision, 'blocked');
      nextAllowed = false;
    }

    if (
      'riskLevel' in result &&
      (execution.forceReviewOnRiskLevels ?? []).includes(result.riskLevel)
    ) {
      this.markOverlayDirectiveApplied(
        appliedOverlayDirectives,
        resolved.governanceOverlay,
        'risk_review_levels',
      );
      alerts.push(
        `Policy requires manual review for ${result.riskLevel} risk transfer assessments`,
      );
      changes.push(`risk_review:${result.riskLevel}`);
      nextDecision = this.maxDecision(nextDecision, 'review_required');
    }

    const missingSafeguards = this.extractMissingSafeguards(
      result,
      execution.requiredSafeguards ?? [],
    );
    if (missingSafeguards.length > 0) {
      this.markOverlayDirectiveApplied(
        appliedOverlayDirectives,
        resolved.governanceOverlay,
        'required_safeguards',
      );
      alerts.push(
        `Policy requires additional safeguards: ${missingSafeguards.join(', ')}`,
      );
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
      trace: this.buildTrace(
        policyRecord,
        this.describeCrossBorderDirectives(execution),
        {
          crossBorderAdjustments: [
            {
              source,
              target,
              changes,
            },
          ],
        },
        resolved.governanceOverlay,
        appliedOverlayDirectives,
      ),
    };
  }

  async applyReportingPolicy(
    organizationId: string,
    policyContext: PolicyExecutionContext,
    request: Record<string, unknown>,
    report: GeneratedReport,
  ): Promise<ReportingPolicyExecutionResult> {
    const policyRecord = await this.getPolicyRecord(
      organizationId,
      policyContext,
    );
    const runtimeGuard = this.buildRuntimeGuard(policyRecord, policyContext);
    if (policyRecord && runtimeGuard) {
      return {
        result: this.attachPolicyOutcome(
          {
            ...report,
            status: 'pending_review' as const,
          },
          [runtimeGuard.reason],
          'blocked',
        ),
        trace: this.buildTrace(
          policyRecord,
          ['governance_pack_runtime_guard'],
          {
            runtimeGuard,
            reportingAdjustments: [
              {
                reportType: String(
                  report.reportType ?? request.reportType ?? 'UNKNOWN',
                ),
                changes: [`runtime_guard:${runtimeGuard.packId}`],
              },
            ],
          },
        ),
      };
    }
    const resolved = this.resolveReportingExecutionDefinition(
      this.extractExecutionDefinition<ReportingExecutionDefinition>(
        policyRecord?.definition,
      ),
      policyContext,
    );
    const execution = resolved.execution;
    if (!policyRecord || !execution) {
      return { result: report };
    }

    const alerts: string[] = [];
    const changes: string[] = [];
    let nextDecision: PolicyDecision = 'allow';
    let nextStatus = report.status;
    const appliedOverlayDirectives = new Set<string>();

    const reportType = String(
      report.reportType ?? request.reportType ?? 'UNKNOWN',
    );
    if (
      (execution.forcePendingReviewForReportTypes ?? []).includes(reportType)
    ) {
      this.markOverlayDirectiveApplied(
        appliedOverlayDirectives,
        resolved.governanceOverlay,
        'pending_review_report_types',
      );
      alerts.push(`Policy requires pending review for ${reportType} reports`);
      changes.push(`pending_review:${reportType}`);
      nextDecision = this.maxDecision(nextDecision, 'review_required');
      nextStatus = 'pending_review';
    }

    const requiredFields =
      execution.requiredRequestFieldsByReportType?.[reportType] ?? [];
    const missingFields = requiredFields.filter(
      (field) => !this.hasNestedValue(request, field),
    );
    if (missingFields.length > 0) {
      this.markOverlayDirectiveApplied(
        appliedOverlayDirectives,
        resolved.governanceOverlay,
        'required_request_fields',
      );
      alerts.push(
        `Policy requires additional report inputs: ${missingFields.join(', ')}`,
      );
      changes.push(`missing_fields:${missingFields.join('|')}`);
      nextDecision = this.maxDecision(nextDecision, 'review_required');
      nextStatus = 'pending_review';
    }

    const priority =
      typeof request.priority === 'string' ? request.priority : null;
    if (
      priority &&
      (execution.forcePendingReviewOnPriorities ?? []).includes(priority)
    ) {
      this.markOverlayDirectiveApplied(
        appliedOverlayDirectives,
        resolved.governanceOverlay,
        'priority_review_gate',
      );
      alerts.push(
        `Policy requires pending review for ${priority} priority reports`,
      );
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
      trace: this.buildTrace(
        policyRecord,
        this.describeReportingDirectives(execution),
        {
          reportingAdjustments: [
            {
              reportType,
              changes,
            },
          ],
        },
        resolved.governanceOverlay,
        appliedOverlayDirectives,
      ),
    };
  }

  async applyPrivacyWorkflowPolicy(
    organizationId: string,
    policyContext: PolicyExecutionContext,
    operation: 'dsar' | 'erasure' | 'pia' | 'breach',
    request: Record<string, unknown> | PIA | BreachNotification,
    result: GeneratedReport | PIAResult | BreachTimeline,
  ): Promise<PrivacyWorkflowPolicyExecutionResult> {
    const policyRecord = await this.getPolicyRecord(
      organizationId,
      policyContext,
    );
    const runtimeGuard = this.buildRuntimeGuard(policyRecord, policyContext);
    if (policyRecord && runtimeGuard) {
      const guardedResult = this.attachPolicyOutcome(
        this.applyPrivacyRuntimeGuard(operation, result),
        [runtimeGuard.reason],
        'blocked',
      );
      return {
        result: guardedResult,
        trace: this.buildTrace(
          policyRecord,
          ['governance_pack_runtime_guard'],
          {
            runtimeGuard,
            privacyAdjustments: [
              {
                operation,
                changes: [`runtime_guard:${runtimeGuard.packId}`],
              },
            ],
          },
        ),
      };
    }
    const resolved = this.resolvePrivacyExecutionDefinition(
      this.extractExecutionDefinition<PrivacyExecutionDefinition>(
        policyRecord?.definition,
      ),
      policyContext,
    );
    const execution = resolved.execution;
    if (!policyRecord || !execution) {
      return { result };
    }

    const alerts: string[] = [];
    const changes: string[] = [];
    let nextDecision: PolicyDecision = 'allow';
    const appliedOverlayDirectives = new Set<string>();

    if (operation === 'dsar' || operation === 'erasure') {
      const report = result as GeneratedReport;
      const requestType = String(
        (request as Record<string, unknown>).requestType ?? operation,
      );
      let nextStatus = report.status;

      if (
        (execution.forcePendingReviewOnRequestTypes ?? []).includes(requestType)
      ) {
        this.markOverlayDirectiveApplied(
          appliedOverlayDirectives,
          resolved.governanceOverlay,
          'privacy_request_review_gate',
        );
        alerts.push(
          `Policy requires pending review for ${requestType} privacy requests`,
        );
        changes.push(`request_type_review:${requestType}`);
        nextDecision = this.maxDecision(nextDecision, 'review_required');
        nextStatus = 'pending_review';
      }

      const requestedCategories = Array.isArray(
        (request as Record<string, unknown>).dataCategories,
      )
        ? (
            (request as Record<string, unknown>).dataCategories as unknown[]
          ).map((entry) => String(entry))
        : [];
      const requiredCategories =
        execution.requiredDataCategoriesByRequestType?.[requestType] ?? [];
      const missingCategories = requiredCategories.filter(
        (category) => !requestedCategories.includes(category),
      );
      if (missingCategories.length > 0) {
        this.markOverlayDirectiveApplied(
          appliedOverlayDirectives,
          resolved.governanceOverlay,
          'required_privacy_data_categories',
        );
        alerts.push(
          `Policy requires additional privacy request categories: ${missingCategories.join(', ')}`,
        );
        changes.push(`missing_categories:${missingCategories.join('|')}`);
        nextDecision = this.maxDecision(nextDecision, 'review_required');
        nextStatus = 'pending_review';
      }

      if (operation === 'erasure') {
        const retentionOverrides = Array.isArray(
          (request as Record<string, unknown>).retentionOverrides,
        )
          ? ((request as Record<string, unknown>).retentionOverrides as Array<
              Record<string, unknown>
            >)
          : [];
        const overrideCategories = new Set(
          retentionOverrides
            .map((entry) => String(entry.category ?? ''))
            .filter((value) => value.length > 0),
        );
        const requiredOverrides = (
          execution.requireRetentionOverridesForErasureCategories ?? []
        )
          .filter((category) => requestedCategories.includes(category))
          .filter((category) => !overrideCategories.has(category));
        if (requiredOverrides.length > 0) {
          this.markOverlayDirectiveApplied(
            appliedOverlayDirectives,
            resolved.governanceOverlay,
            'required_retention_overrides',
          );
          alerts.push(
            `Policy requires retention overrides for erasure categories: ${requiredOverrides.join(', ')}`,
          );
          changes.push(
            `missing_retention_overrides:${requiredOverrides.join('|')}`,
          );
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
        trace: this.buildTrace(
          policyRecord,
          this.describePrivacyDirectives(execution),
          {
            privacyAdjustments: [
              {
                operation,
                changes,
              },
            ],
          },
          resolved.governanceOverlay,
          appliedOverlayDirectives,
        ),
      };
    }

    if (operation === 'pia') {
      const piaResult = result as PIAResult;
      const piaRequest = request as PIA;
      const nextRecommendations = [...piaResult.recommendations];
      const nextFindings = [...piaResult.findings];
      let nextSupervisoryConsultationRequired =
        piaResult.supervisoryConsultationRequired;

      if (
        (execution.forceSupervisoryConsultationRiskLevels ?? []).includes(
          piaResult.riskLevel,
        ) &&
        !nextSupervisoryConsultationRequired
      ) {
        this.markOverlayDirectiveApplied(
          appliedOverlayDirectives,
          resolved.governanceOverlay,
          'supervisory_consultation_risk_levels',
        );
        alerts.push(
          `Policy requires supervisory consultation for ${piaResult.riskLevel} risk PIAs`,
        );
        changes.push(`supervisory_consultation:${piaResult.riskLevel}`);
        nextDecision = this.maxDecision(nextDecision, 'review_required');
        nextSupervisoryConsultationRequired = true;
        nextRecommendations.push(
          'Escalate to supervisory authority review under policy control',
        );
      }

      if (
        execution.requireProcessorDpas &&
        piaRequest.thirdPartyProcessors.some(
          (processor) => !processor.dpaInPlace,
        )
      ) {
        this.markOverlayDirectiveApplied(
          appliedOverlayDirectives,
          resolved.governanceOverlay,
          'processor_dpa_requirement',
        );
        alerts.push(
          'Policy requires signed DPAs for all third-party processors',
        );
        changes.push('missing_dpa:true');
        nextDecision = this.maxDecision(nextDecision, 'review_required');
        nextFindings.push({
          area: 'Policy Processor Governance',
          risk: 'One or more processors lack signed data processing agreements',
          severity: 'high',
          mitigation:
            'Complete DPA execution before proceeding under sovereign policy controls.',
        });
      }

      if (
        execution.forcePendingReviewOnCrossBorderPIA &&
        piaRequest.crossBorderTransfer
      ) {
        this.markOverlayDirectiveApplied(
          appliedOverlayDirectives,
          resolved.governanceOverlay,
          'cross_border_pia_review_gate',
        );
        alerts.push(
          'Policy requires review for PIAs involving cross-border transfers',
        );
        changes.push('cross_border_pia:true');
        nextDecision = this.maxDecision(nextDecision, 'review_required');
        nextRecommendations.push(
          'Route this PIA through cross-border review board before launch',
        );
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
        trace: this.buildTrace(
          policyRecord,
          this.describePrivacyDirectives(execution),
          {
            privacyAdjustments: [
              {
                operation,
                changes,
              },
            ],
          },
          resolved.governanceOverlay,
          appliedOverlayDirectives,
        ),
      };
    }

    const breachTimeline = result as BreachTimeline;
    const breachRequest = request as BreachNotification;
    let nextDataSubjectNotificationRequired =
      breachTimeline.dataSubjectNotificationRequired;
    let nextDataSubjectDeadlineHours = breachTimeline.dataSubjectDeadlineHours;
    let nextDeadlines = breachTimeline.regulatoryDeadlines;

    if (
      (execution.forceSubjectNotificationSeverities ?? []).includes(
        breachRequest.severity,
      ) &&
      !nextDataSubjectNotificationRequired
    ) {
      this.markOverlayDirectiveApplied(
        appliedOverlayDirectives,
        resolved.governanceOverlay,
        'breach_subject_notification_gate',
      );
      alerts.push(
        `Policy requires data subject notification for ${breachRequest.severity} severity breaches`,
      );
      changes.push(`subject_notification:${breachRequest.severity}`);
      nextDecision = this.maxDecision(nextDecision, 'review_required');
      nextDataSubjectNotificationRequired = true;
      nextDataSubjectDeadlineHours =
        nextDataSubjectDeadlineHours > 0 ? nextDataSubjectDeadlineHours : 72;
    }

    if (
      execution.acceleratedBreachDeadlineHours &&
      execution.acceleratedBreachDeadlineHours > 0
    ) {
      const accelerated: typeof breachTimeline.regulatoryDeadlines = [];
      let acceleratedAny = false;
      for (const deadline of breachTimeline.regulatoryDeadlines) {
        if (deadline.deadlineHours > execution.acceleratedBreachDeadlineHours) {
          acceleratedAny = true;
          changes.push(`accelerated_deadline:${deadline.jurisdiction}`);
          accelerated.push({
            ...deadline,
            deadlineHours: execution.acceleratedBreachDeadlineHours,
            deadline: new Date(
              new Date(breachRequest.detectedAt).getTime() +
                execution.acceleratedBreachDeadlineHours * 60 * 60 * 1000,
            ).toISOString(),
          });
        } else {
          accelerated.push(deadline);
        }
      }

      if (acceleratedAny) {
        this.markOverlayDirectiveApplied(
          appliedOverlayDirectives,
          resolved.governanceOverlay,
          'accelerated_breach_deadlines',
        );
        alerts.push(
          `Policy accelerates breach escalation to ${execution.acceleratedBreachDeadlineHours} hours for one or more jurisdictions`,
        );
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
      trace: this.buildTrace(
        policyRecord,
        this.describePrivacyDirectives(execution),
        {
          privacyAdjustments: [
            {
              operation,
              changes,
            },
          ],
        },
        resolved.governanceOverlay,
        appliedOverlayDirectives,
      ),
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

  private resolveComplianceExecutionDefinition(
    execution: ComplianceExecutionDefinition | null,
    policyContext: PolicyExecutionContext,
  ): ResolvedExecutionDefinition<ComplianceExecutionDefinition> {
    const packId = policyContext.policyApprovalContext?.governancePackId;
    if (!packId) {
      return { execution };
    }

    const packDefaults: Partial<ComplianceExecutionDefinition> = {};
    if (packId === 'sovereign-core') {
      packDefaults.acceptedIssuerAssuranceLevels = ['qualified'];
      packDefaults.forcePendingReviewOnWarnings = true;
    }

    return {
      execution: this.mergeComplianceExecutionDefinition(
        execution,
        packDefaults,
      ),
      governanceOverlay: this.buildGovernanceOverlay(
        policyContext,
        this.describeComplianceDirectives(packDefaults),
      ),
    };
  }

  private resolveScreeningExecutionDefinition(
    execution: ScreeningExecutionDefinition | null,
    policyContext: PolicyExecutionContext,
  ): ResolvedExecutionDefinition<ScreeningExecutionDefinition> {
    const packId = policyContext.policyApprovalContext?.governancePackId;
    if (!packId) {
      return { execution };
    }

    const packDefaults: Partial<ScreeningExecutionDefinition> = {};
    if (packId === 'enterprise-screening') {
      packDefaults.requiredListSources = ['ofac_sdn', 'un_sanctions'];
      packDefaults.forceReviewOnPepMatches = true;
    } else if (packId === 'sovereign-core') {
      packDefaults.requiredListSources = [
        'ofac_sdn',
        'un_sanctions',
        'pep_database',
      ];
      packDefaults.forceReviewOnPepMatches = true;
    }

    return {
      execution: this.mergeScreeningExecutionDefinition(
        execution,
        packDefaults,
      ),
      governanceOverlay: this.buildGovernanceOverlay(
        policyContext,
        this.describeScreeningDirectives(packDefaults),
      ),
    };
  }

  private resolveBatchScreeningExecutionDefinition(
    execution: BatchScreeningExecutionDefinition | null,
    policyContext: PolicyExecutionContext,
  ): ResolvedExecutionDefinition<BatchScreeningExecutionDefinition> {
    const packId = policyContext.policyApprovalContext?.governancePackId;
    if (!packId) {
      return { execution };
    }

    const packDefaults: Partial<BatchScreeningExecutionDefinition> = {};
    if (packId === 'enterprise-screening') {
      packDefaults.maximumBatchSize = 250;
      packDefaults.forceReviewOnPriorities = ['high'];
    } else if (packId === 'sovereign-core') {
      packDefaults.maximumBatchSize = 100;
      packDefaults.forceReviewOnPriorities = ['high', 'urgent'];
    }

    return {
      execution: this.mergeBatchScreeningExecutionDefinition(
        execution,
        packDefaults,
      ),
      governanceOverlay: this.buildGovernanceOverlay(
        policyContext,
        this.describeBatchScreeningDirectives(packDefaults),
      ),
    };
  }

  private resolveCrossBorderExecutionDefinition(
    execution: CrossBorderExecutionDefinition | null,
    policyContext: PolicyExecutionContext,
  ): ResolvedExecutionDefinition<CrossBorderExecutionDefinition> {
    const packId = policyContext.policyApprovalContext?.governancePackId;
    if (!packId) {
      return { execution };
    }

    const packDefaults: Partial<CrossBorderExecutionDefinition> = {};
    if (packId === 'cross-border-regulated') {
      packDefaults.requiredSafeguards = ['customer_managed_keys'];
      packDefaults.forceReviewOnRiskLevels = ['high', 'prohibited'];
    } else if (packId === 'sovereign-core') {
      packDefaults.requiredSafeguards = ['customer_managed_keys'];
      packDefaults.requiredLegalBases = ['binding_corporate_rules'];
      packDefaults.forceReviewOnRiskLevels = ['medium', 'high', 'prohibited'];
    }

    return {
      execution: this.mergeCrossBorderExecutionDefinition(
        execution,
        packDefaults,
      ),
      governanceOverlay: this.buildGovernanceOverlay(
        policyContext,
        this.describeCrossBorderDirectives(packDefaults),
      ),
    };
  }

  private resolveReportingExecutionDefinition(
    execution: ReportingExecutionDefinition | null,
    policyContext: PolicyExecutionContext,
  ): ResolvedExecutionDefinition<ReportingExecutionDefinition> {
    const packId = policyContext.policyApprovalContext?.governancePackId;
    if (!packId) {
      return { execution };
    }

    const packDefaults: Partial<ReportingExecutionDefinition> = {};
    if (packId === 'enterprise-reporting') {
      packDefaults.forcePendingReviewForReportTypes = ['SAR', 'CTR', 'STR'];
    } else if (packId === 'sovereign-core') {
      packDefaults.forcePendingReviewForReportTypes = ['SAR', 'CTR', 'STR'];
      packDefaults.requiredRequestFieldsByReportType = {
        SAR: ['filingInstitution.registrationNumber'],
        CTR: ['filingInstitution.registrationNumber'],
        STR: ['filingInstitution.registrationNumber'],
      };
    }

    return {
      execution: this.mergeReportingExecutionDefinition(
        execution,
        packDefaults,
      ),
      governanceOverlay: this.buildGovernanceOverlay(
        policyContext,
        this.describeReportingDirectives(packDefaults),
      ),
    };
  }

  private resolvePrivacyExecutionDefinition(
    execution: PrivacyExecutionDefinition | null,
    policyContext: PolicyExecutionContext,
  ): ResolvedExecutionDefinition<PrivacyExecutionDefinition> {
    const packId = policyContext.policyApprovalContext?.governancePackId;
    if (!packId) {
      return { execution };
    }

    const packDefaults: Partial<PrivacyExecutionDefinition> = {};
    if (packId === 'enterprise-privacy') {
      packDefaults.forcePendingReviewOnRequestTypes = ['access', 'erasure'];
      packDefaults.forceSupervisoryConsultationRiskLevels = ['high'];
      packDefaults.forceSubjectNotificationSeverities = ['high'];
    } else if (packId === 'sovereign-core') {
      packDefaults.forcePendingReviewOnRequestTypes = ['access', 'erasure'];
      packDefaults.forceSupervisoryConsultationRiskLevels = ['medium', 'high'];
      packDefaults.requireProcessorDpas = true;
      packDefaults.forcePendingReviewOnCrossBorderPIA = true;
      packDefaults.forceSubjectNotificationSeverities = ['medium', 'high'];
      packDefaults.acceleratedBreachDeadlineHours = 24;
    }

    return {
      execution: this.mergePrivacyExecutionDefinition(execution, packDefaults),
      governanceOverlay: this.buildGovernanceOverlay(
        policyContext,
        this.describePrivacyDirectives(packDefaults),
      ),
    };
  }

  private buildTrace(
    policyRecord: PolicyRecord,
    directives: string[],
    fields: Omit<
      PolicyExecutionTrace,
      'policyDefinitionId' | 'policyName' | 'policyVersion' | 'directives'
    >,
    governanceOverlay?: GovernanceOverlayTrace,
    appliedOverlayDirectives?: Set<string>,
  ): PolicyExecutionTrace {
    return {
      policyDefinitionId: policyRecord.id,
      policyName: policyRecord.name,
      policyVersion: policyRecord.version,
      directives,
      ...(governanceOverlay
        ? {
            governanceOverlay: {
              ...governanceOverlay,
              ...(appliedOverlayDirectives && appliedOverlayDirectives.size > 0
                ? {
                    appliedDirectives: governanceOverlay.directives.filter(
                      (directive) => appliedOverlayDirectives.has(directive),
                    ),
                  }
                : {}),
            },
          }
        : {}),
      ...fields,
    };
  }

  private buildGovernanceOverlay(
    policyContext: PolicyExecutionContext,
    directives: string[],
  ): GovernanceOverlayTrace | undefined {
    const packId = policyContext.policyApprovalContext?.governancePackId;
    if (!packId || directives.length === 0) {
      return undefined;
    }

    return {
      packId,
      ...(policyContext.policyApprovalContext?.governancePackVersion
        ? {
            packVersion:
              policyContext.policyApprovalContext.governancePackVersion,
          }
        : {}),
      ...(policyContext.policyApprovalContext?.governancePackLabel
        ? { packLabel: policyContext.policyApprovalContext.governancePackLabel }
        : {}),
      directives,
    };
  }

  private buildRuntimeGuard(
    policyRecord: PolicyRecord | null,
    policyContext: PolicyExecutionContext,
  ): PolicyExecutionTrace['runtimeGuard'] | undefined {
    if (!policyRecord) {
      return undefined;
    }

    const packId = policyContext.policyApprovalContext?.governancePackId;
    if (
      !packId ||
      !policyRecord.definition ||
      typeof policyRecord.definition !== 'object'
    ) {
      return undefined;
    }

    const issue = policyGovernanceService.validatePolicyDefinitionCompatibility(
      policyContext.policyFamily,
      packId,
      policyRecord.definition as Record<string, unknown>,
    );
    if (!issue) {
      return undefined;
    }

    return {
      code: 'governance_pack_definition_invalid',
      packId: issue.packId,
      reason: issue.reason,
    };
  }

  private markOverlayDirectiveApplied(
    appliedOverlayDirectives: Set<string>,
    governanceOverlay: GovernanceOverlayTrace | undefined,
    directive: string,
  ): void {
    if (governanceOverlay?.directives.includes(directive)) {
      appliedOverlayDirectives.add(directive);
    }
  }

  private applyPrivacyRuntimeGuard(
    operation: 'dsar' | 'erasure' | 'pia' | 'breach',
    result: GeneratedReport | PIAResult | BreachTimeline,
  ): PrivacyWorkflowAdjustedResult {
    if (operation === 'dsar' || operation === 'erasure') {
      return {
        ...(result as GeneratedReport),
        status: 'pending_review',
      };
    }

    return result as PrivacyWorkflowAdjustedResult;
  }

  private mergeComplianceExecutionDefinition(
    execution: ComplianceExecutionDefinition | null,
    defaults: Partial<ComplianceExecutionDefinition>,
  ): ComplianceExecutionDefinition | null {
    if (!execution && Object.keys(defaults).length === 0) {
      return null;
    }

    return {
      ...(execution ?? {}),
      ...(defaults.additionalRequiredCredentialsByOperation ||
      execution?.additionalRequiredCredentialsByOperation
        ? {
            additionalRequiredCredentialsByOperation: this.mergeRecordArrays(
              execution?.additionalRequiredCredentialsByOperation,
              defaults.additionalRequiredCredentialsByOperation,
            ),
          }
        : {}),
      hardFailureCredentialTypes: this.mergeStringArrays(
        execution?.hardFailureCredentialTypes,
        defaults.hardFailureCredentialTypes,
      ),
      ...(this.pickLowerNumber(
        execution?.credentialFreshnessMaxAgeDays,
        defaults.credentialFreshnessMaxAgeDays,
      ) !== undefined
        ? {
            credentialFreshnessMaxAgeDays: this.pickLowerNumber(
              execution?.credentialFreshnessMaxAgeDays,
              defaults.credentialFreshnessMaxAgeDays,
            ),
          }
        : {}),
      credentialFreshnessSeverity:
        execution?.credentialFreshnessSeverity ??
        defaults.credentialFreshnessSeverity,
      requireTrustedIssuerForCredentialTypes: this.mergeStringArrays(
        execution?.requireTrustedIssuerForCredentialTypes,
        defaults.requireTrustedIssuerForCredentialTypes,
      ),
      acceptedIssuerAssuranceLevels: this.mergeStringArrays(
        execution?.acceptedIssuerAssuranceLevels,
        defaults.acceptedIssuerAssuranceLevels,
      ),
      forcePendingReviewOnWarnings: Boolean(
        execution?.forcePendingReviewOnWarnings ||
        defaults.forcePendingReviewOnWarnings,
      ),
    };
  }

  private mergeScreeningExecutionDefinition(
    execution: ScreeningExecutionDefinition | null,
    defaults: Partial<ScreeningExecutionDefinition>,
  ): ScreeningExecutionDefinition | null {
    if (!execution && Object.keys(defaults).length === 0) {
      return null;
    }

    return {
      ...(execution ?? {}),
      requiredListSources: this.mergeStringArrays(
        execution?.requiredListSources,
        defaults.requiredListSources,
      ),
      forceReviewOnPepMatches: Boolean(
        execution?.forceReviewOnPepMatches || defaults.forceReviewOnPepMatches,
      ),
      reviewRiskLevels: this.mergeStringArrays(
        execution?.reviewRiskLevels,
        defaults.reviewRiskLevels,
      ) as Array<ScreeningResult['overallRisk']> | undefined,
      blockEntityTypes: this.mergeStringArrays(
        execution?.blockEntityTypes,
        defaults.blockEntityTypes,
      ) as Array<ScreeningRequest['entityType']> | undefined,
      ...(this.pickLowerNumber(
        execution?.minimumPotentialMatchScore,
        defaults.minimumPotentialMatchScore,
      ) !== undefined
        ? {
            minimumPotentialMatchScore: this.pickLowerNumber(
              execution?.minimumPotentialMatchScore,
              defaults.minimumPotentialMatchScore,
            ),
          }
        : {}),
    };
  }

  private mergeBatchScreeningExecutionDefinition(
    execution: BatchScreeningExecutionDefinition | null,
    defaults: Partial<BatchScreeningExecutionDefinition>,
  ): BatchScreeningExecutionDefinition | null {
    if (!execution && Object.keys(defaults).length === 0) {
      return null;
    }

    return {
      ...(execution ?? {}),
      ...(this.pickLowerNumber(
        execution?.maximumBatchSize,
        defaults.maximumBatchSize,
      ) !== undefined
        ? {
            maximumBatchSize: this.pickLowerNumber(
              execution?.maximumBatchSize,
              defaults.maximumBatchSize,
            ),
          }
        : {}),
      ...(this.pickLowerNumber(
        execution?.maxConfirmedMatchesBeforeReview,
        defaults.maxConfirmedMatchesBeforeReview,
      ) !== undefined
        ? {
            maxConfirmedMatchesBeforeReview: this.pickLowerNumber(
              execution?.maxConfirmedMatchesBeforeReview,
              defaults.maxConfirmedMatchesBeforeReview,
            ),
          }
        : {}),
      forceReviewOnPriorities: this.mergeStringArrays(
        execution?.forceReviewOnPriorities,
        defaults.forceReviewOnPriorities,
      ) as BatchScreeningExecutionDefinition['forceReviewOnPriorities'],
    };
  }

  private mergeCrossBorderExecutionDefinition(
    execution: CrossBorderExecutionDefinition | null,
    defaults: Partial<CrossBorderExecutionDefinition>,
  ): CrossBorderExecutionDefinition | null {
    if (!execution && Object.keys(defaults).length === 0) {
      return null;
    }

    return {
      ...(execution ?? {}),
      prohibitedJurisdictionPairs: this.mergeStringArrays(
        execution?.prohibitedJurisdictionPairs,
        defaults.prohibitedJurisdictionPairs,
      ),
      disallowedDataCategories: this.mergeStringArrays(
        execution?.disallowedDataCategories,
        defaults.disallowedDataCategories,
      ),
      requiredLegalBases: this.mergeStringArrays(
        execution?.requiredLegalBases,
        defaults.requiredLegalBases,
      ),
      requiredSafeguards: this.mergeStringArrays(
        execution?.requiredSafeguards,
        defaults.requiredSafeguards,
      ),
      blockedTransferMechanisms: this.mergeStringArrays(
        execution?.blockedTransferMechanisms,
        defaults.blockedTransferMechanisms,
      ) as Array<CrossBorderResult['dataTransferMechanism']> | undefined,
      forceReviewOnRiskLevels: this.mergeStringArrays(
        execution?.forceReviewOnRiskLevels,
        defaults.forceReviewOnRiskLevels,
      ) as Array<TransferAssessmentResult['riskLevel']> | undefined,
    };
  }

  private mergeReportingExecutionDefinition(
    execution: ReportingExecutionDefinition | null,
    defaults: Partial<ReportingExecutionDefinition>,
  ): ReportingExecutionDefinition | null {
    if (!execution && Object.keys(defaults).length === 0) {
      return null;
    }

    return {
      ...(execution ?? {}),
      forcePendingReviewForReportTypes: this.mergeStringArrays(
        execution?.forcePendingReviewForReportTypes,
        defaults.forcePendingReviewForReportTypes,
      ),
      ...(execution?.requiredRequestFieldsByReportType ||
      defaults.requiredRequestFieldsByReportType
        ? {
            requiredRequestFieldsByReportType: this.mergeRecordArrays(
              execution?.requiredRequestFieldsByReportType,
              defaults.requiredRequestFieldsByReportType,
            ),
          }
        : {}),
      forcePendingReviewOnPriorities: this.mergeStringArrays(
        execution?.forcePendingReviewOnPriorities,
        defaults.forcePendingReviewOnPriorities,
      ),
    };
  }

  private mergePrivacyExecutionDefinition(
    execution: PrivacyExecutionDefinition | null,
    defaults: Partial<PrivacyExecutionDefinition>,
  ): PrivacyExecutionDefinition | null {
    if (!execution && Object.keys(defaults).length === 0) {
      return null;
    }

    return {
      ...(execution ?? {}),
      forcePendingReviewOnRequestTypes: this.mergeStringArrays(
        execution?.forcePendingReviewOnRequestTypes,
        defaults.forcePendingReviewOnRequestTypes,
      ),
      ...(execution?.requiredDataCategoriesByRequestType ||
      defaults.requiredDataCategoriesByRequestType
        ? {
            requiredDataCategoriesByRequestType: this.mergeRecordArrays(
              execution?.requiredDataCategoriesByRequestType,
              defaults.requiredDataCategoriesByRequestType,
            ),
          }
        : {}),
      requireRetentionOverridesForErasureCategories: this.mergeStringArrays(
        execution?.requireRetentionOverridesForErasureCategories,
        defaults.requireRetentionOverridesForErasureCategories,
      ),
      forceSupervisoryConsultationRiskLevels: this.mergeStringArrays(
        execution?.forceSupervisoryConsultationRiskLevels,
        defaults.forceSupervisoryConsultationRiskLevels,
      ) as Array<PIAResult['riskLevel']> | undefined,
      requireProcessorDpas: Boolean(
        execution?.requireProcessorDpas || defaults.requireProcessorDpas,
      ),
      forcePendingReviewOnCrossBorderPIA: Boolean(
        execution?.forcePendingReviewOnCrossBorderPIA ||
        defaults.forcePendingReviewOnCrossBorderPIA,
      ),
      forceSubjectNotificationSeverities: this.mergeStringArrays(
        execution?.forceSubjectNotificationSeverities,
        defaults.forceSubjectNotificationSeverities,
      ) as Array<BreachNotification['severity']> | undefined,
      ...(this.pickLowerNumber(
        execution?.acceleratedBreachDeadlineHours,
        defaults.acceleratedBreachDeadlineHours,
      ) !== undefined
        ? {
            acceleratedBreachDeadlineHours: this.pickLowerNumber(
              execution?.acceleratedBreachDeadlineHours,
              defaults.acceleratedBreachDeadlineHours,
            ),
          }
        : {}),
    };
  }

  private describeComplianceDirectives(
    execution: ComplianceExecutionDefinition,
  ): string[] {
    const directives: string[] = [];
    if (
      execution.additionalRequiredCredentialsByOperation &&
      Object.keys(execution.additionalRequiredCredentialsByOperation).length > 0
    ) {
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

  private describeScreeningDirectives(
    execution: ScreeningExecutionDefinition,
  ): string[] {
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

  private describeBatchScreeningDirectives(
    execution: BatchScreeningExecutionDefinition,
  ): string[] {
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

  private describeCrossBorderDirectives(
    execution: CrossBorderExecutionDefinition,
  ): string[] {
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

  private describeReportingDirectives(
    execution: ReportingExecutionDefinition,
  ): string[] {
    const directives: string[] = [];
    if ((execution.forcePendingReviewForReportTypes ?? []).length > 0) {
      directives.push('pending_review_report_types');
    }
    if (
      execution.requiredRequestFieldsByReportType &&
      Object.keys(execution.requiredRequestFieldsByReportType).length > 0
    ) {
      directives.push('required_request_fields');
    }
    if ((execution.forcePendingReviewOnPriorities ?? []).length > 0) {
      directives.push('priority_review_gate');
    }
    return directives;
  }

  private describePrivacyDirectives(
    execution: PrivacyExecutionDefinition,
  ): string[] {
    const directives: string[] = [];
    if ((execution.forcePendingReviewOnRequestTypes ?? []).length > 0) {
      directives.push('privacy_request_review_gate');
    }
    if (
      execution.requiredDataCategoriesByRequestType &&
      Object.keys(execution.requiredDataCategoriesByRequestType).length > 0
    ) {
      directives.push('required_privacy_data_categories');
    }
    if (
      (execution.requireRetentionOverridesForErasureCategories ?? []).length > 0
    ) {
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

  private attachPolicyOutcome<T extends object>(
    result: T,
    alerts: string[],
    decision: PolicyDecision,
  ): T & {
    policyAlerts?: string[];
    policyDecision?: PolicyDecision;
  } {
    return {
      ...result,
      ...(alerts.length > 0 ? { policyAlerts: alerts } : {}),
      ...(decision !== 'allow' ? { policyDecision: decision } : {}),
    };
  }

  private maxDecision(
    current: PolicyDecision,
    next: PolicyDecision,
  ): PolicyDecision {
    const ordering: Record<PolicyDecision, number> = {
      allow: 0,
      review_required: 1,
      blocked: 2,
    };

    return ordering[next] > ordering[current] ? next : current;
  }

  private extractDataCategories(
    request: CrossBorderAssessment | CrossBorderTransfer,
  ): string[] {
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
      const missingSafeguards = input.requiredSafeguards.filter(
        (safeguard) => !result.requiredSafeguards.includes(safeguard),
      );
      return {
        ...result,
        allowed: input.allowed,
        requiredSafeguards: [
          ...result.requiredSafeguards,
          ...missingSafeguards,
        ],
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

    return requiredSafeguards.filter(
      (safeguard) => !result.requiredSafeguards.includes(safeguard),
    );
  }

  private hasNestedValue(
    input: Record<string, unknown>,
    path: string,
  ): boolean {
    const segments = path.split('.');
    let currentValue: unknown = input;
    for (const segment of segments) {
      if (
        !currentValue ||
        typeof currentValue !== 'object' ||
        !(segment in (currentValue as Record<string, unknown>))
      ) {
        return false;
      }
      currentValue = (currentValue as Record<string, unknown>)[segment];
    }

    if (currentValue === null || currentValue === undefined) {
      return false;
    }

    if (typeof currentValue === 'string') {
      return currentValue.trim().length > 0;
    }

    if (Array.isArray(currentValue)) {
      return currentValue.length > 0;
    }

    return true;
  }

  private mergeStringArrays<T extends string>(
    left?: T[],
    right?: T[],
  ): T[] | undefined {
    const merged = [...new Set([...(left ?? []), ...(right ?? [])])];
    return merged.length > 0 ? merged : undefined;
  }

  private mergeRecordArrays(
    left?: Record<string, string[]>,
    right?: Record<string, string[]>,
  ): Record<string, string[]> | undefined {
    const keys = [
      ...new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})]),
    ];
    if (keys.length === 0) {
      return undefined;
    }

    return keys.reduce<Record<string, string[]>>((acc, key) => {
      const merged = this.mergeStringArrays(left?.[key], right?.[key]);
      if (merged) {
        acc[key] = merged;
      }
      return acc;
    }, {});
  }

  private pickLowerNumber(left?: number, right?: number): number | undefined {
    if (typeof left !== 'number') {
      return right;
    }
    if (typeof right !== 'number') {
      return left;
    }
    return Math.min(left, right);
  }
}

export const policyExecutionService = new PolicyExecutionService();
