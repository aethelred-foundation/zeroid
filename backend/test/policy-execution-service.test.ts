const mockPolicyDefinitionFindFirst = jest.fn();

jest.mock('../src/index', () => ({
  prisma: {
    policyDefinition: {
      findFirst: mockPolicyDefinitionFindFirst,
    },
  },
}));

import { policyExecutionService } from '../src/services/enterprise/policy-execution-service';

describe('PolicyExecutionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPolicyDefinitionFindFirst.mockResolvedValue(null);
  });

  it('returns original results when there is no organization policy definition', async () => {
    const results = await policyExecutionService.applyCompliancePolicy(
      'org-1',
      {
        policyName: 'jurisdiction_compliance',
        policyVersion: '2026.04.1',
        policyReference: 'zeroid://policy/compliance/jurisdiction_compliance@2026.04.1',
        policyFamily: 'compliance',
      },
      {
        entityId: 'entity-1',
        entityType: 'individual',
        jurisdictions: ['AE-ADGM'],
        credentials: [],
        operationType: 'onboarding',
      },
      [
        {
          entityId: 'entity-1',
          jurisdiction: 'AE-ADGM',
          overallStatus: 'compliant',
          missingCredentials: [],
          expiringCredentials: [],
          rules: [],
          lastEvaluated: '2026-04-21T00:00:00.000Z',
          nextReviewDate: '2026-10-18T00:00:00.000Z',
        },
      ],
    );

    expect(results.trace).toBeUndefined();
    expect(results.results[0].overallStatus).toBe('compliant');
  });

  it('applies executable policy directives to compliance outcomes', async () => {
    mockPolicyDefinitionFindFirst.mockResolvedValue({
      id: 'policy-7',
      name: 'jurisdiction_compliance',
      version: '2026.07.0',
      definition: {
        execution: {
          additionalRequiredCredentialsByOperation: {
            onboarding: ['source_of_funds'],
          },
          hardFailureCredentialTypes: ['source_of_funds'],
          credentialFreshnessMaxAgeDays: 180,
          credentialFreshnessSeverity: 'warning',
          requireTrustedIssuerForCredentialTypes: ['kyc_enhanced'],
          acceptedIssuerAssuranceLevels: ['qualified'],
          forcePendingReviewOnWarnings: true,
        },
      },
    });

    const outcome = await policyExecutionService.applyCompliancePolicy(
      'org-1',
      {
        policyName: 'jurisdiction_compliance',
        policyVersion: '2026.07.0',
        policyDefinitionId: 'policy-7',
        policyReference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.07.0',
        policyFamily: 'compliance',
        trustContext: {
          organizationId: 'org-1',
          evaluatedIssuerCount: 1,
          accreditedIssuerCount: 1,
          enforced: true,
          anchors: [
            {
              issuerIdentityId: 'issuer-1',
              issuerDid: 'did:aethelred:issuer:1',
              issuerDisplayName: 'Issuer One',
              trustRecordId: 'trust-1',
              status: 'accredited',
              accreditationScope: 'sovereign',
              assuranceLevel: 'standard',
              accepted: true,
              evaluatedCredentialTypes: ['kyc_enhanced'],
              matchedJurisdictions: ['AE-ADGM'],
            },
          ],
        },
      },
      {
        entityId: 'entity-1',
        entityType: 'individual',
        jurisdictions: ['AE-ADGM'],
        credentials: [
          {
            credentialType: 'kyc_enhanced',
            issuerId: 'issuer-1',
            issuingJurisdiction: 'AE-ADGM',
            claims: {},
            issuedAt: '2025-01-01T00:00:00.000Z',
          },
        ],
        operationType: 'onboarding',
      },
      [
        {
          entityId: 'entity-1',
          jurisdiction: 'AE-ADGM',
          overallStatus: 'compliant',
          missingCredentials: [],
          expiringCredentials: [],
          rules: [
            { ruleId: 'base-rule', name: 'KYC Completeness', status: 'pass', detail: 'All required credentials present' },
          ],
          lastEvaluated: '2026-04-21T00:00:00.000Z',
          nextReviewDate: '2026-10-18T00:00:00.000Z',
        },
      ],
    );

    expect(outcome.results[0]).toMatchObject({
      overallStatus: 'non_compliant',
      missingCredentials: ['source_of_funds'],
    });
    expect(outcome.results[0].rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Policy Additional Credentials', status: 'fail' }),
        expect.objectContaining({ name: 'Policy Hard Failure Credentials', status: 'fail' }),
        expect.objectContaining({ name: 'Policy Credential Freshness', status: 'warning' }),
        expect.objectContaining({ name: 'Policy Issuer Assurance Threshold', status: 'fail' }),
      ]),
    );
    expect(outcome.trace).toMatchObject({
      policyDefinitionId: 'policy-7',
      directives: expect.arrayContaining([
        'additional_required_credentials',
        'hard_failure_credentials',
        'credential_freshness_window',
        'trusted_issuer_requirement',
        'issuer_assurance_threshold',
        'force_pending_review_on_warnings',
      ]),
      jurisdictionAdjustments: [
        expect.objectContaining({
          jurisdiction: 'AE-ADGM',
        }),
      ],
    });
  });

  it('applies screening policy directives to sanctions results', async () => {
    mockPolicyDefinitionFindFirst.mockResolvedValue({
      id: 'policy-screening-1',
      name: 'sanctions_screening',
      version: '2026.07.0',
      definition: {
        execution: {
          requiredListSources: ['ofac_sdn', 'pep_database'],
          forceReviewOnPepMatches: true,
          blockEntityTypes: ['vessel'],
          minimumPotentialMatchScore: 0.91,
        },
      },
    });

    const outcome = await policyExecutionService.applyScreeningPolicy(
      'org-1',
      {
        policyName: 'sanctions_screening',
        policyVersion: '2026.07.0',
        policyDefinitionId: 'policy-screening-1',
        policyReference: 'zeroid://policy/org/org-1/sanctions_screening@2026.07.0',
        policyFamily: 'screening',
      },
      {
        entityId: 'entity-9',
        entityType: 'vessel',
        names: [{ fullName: 'MV Horizon', nameType: 'primary', script: 'latin' }],
        identifiers: [],
        addresses: [],
        screenAgainst: ['ofac_sdn'],
      },
      {
        screeningId: 'screen-1',
        entityId: 'entity-9',
        timestamp: '2026-04-21T00:00:00.000Z',
        overallRisk: 'clear',
        matches: [
          {
            matchId: 'match-1',
            listSource: 'pep_database',
            listEntryId: 'pep-1',
            matchedName: 'MV Horizon',
            matchScore: 0.95,
            matchType: 'fuzzy',
            matchedFields: ['name'],
            listingDetails: {
              programs: [],
              listedDate: '2026-01-01T00:00:00.000Z',
              remarks: 'PEP linkage',
            },
            status: 'pending_review',
          },
        ],
        listsScreened: ['ofac_sdn'],
        processingTimeMs: 10,
        nextScreeningDate: '2026-04-22T00:00:00.000Z',
      },
    );

    expect(outcome.result).toMatchObject({
      overallRisk: 'potential_match',
      policyDecision: 'blocked',
    });
    expect(outcome.result.policyAlerts).toEqual(
      expect.arrayContaining([
        'Required screening lists were not covered: pep_database',
        'Policy requires manual review for politically exposed person matches',
        'Policy blocks screening disposition for entity type vessel',
      ]),
    );
    expect(outcome.trace).toMatchObject({
      policyDefinitionId: 'policy-screening-1',
      directives: expect.arrayContaining([
        'required_screening_lists',
        'pep_review_requirement',
        'entity_type_blocklist',
        'potential_match_score_threshold',
      ]),
      screeningAdjustments: [
        expect.objectContaining({
          entityId: 'entity-9',
        }),
      ],
    });
  });

  it('applies cross-border policy directives to transfer assessments', async () => {
    mockPolicyDefinitionFindFirst.mockResolvedValue({
      id: 'policy-transfer-1',
      name: 'data_sovereignty_cross_border',
      version: '2026.07.0',
      definition: {
        execution: {
          prohibitedJurisdictionPairs: ['AE-ADGM->EU-GDPR'],
          disallowedDataCategories: ['biometric'],
          requiredLegalBases: ['binding_corporate_rules'],
          requiredSafeguards: ['customer_managed_keys'],
          forceReviewOnRiskLevels: ['high', 'prohibited'],
        },
      },
    });

    const outcome = await policyExecutionService.applyCrossBorderPolicy(
      'org-1',
      {
        policyName: 'data_sovereignty_cross_border',
        policyVersion: '2026.07.0',
        policyDefinitionId: 'policy-transfer-1',
        policyReference: 'zeroid://policy/org/org-1/data_sovereignty_cross_border@2026.07.0',
        policyFamily: 'privacy',
      },
      {
        sourceJurisdiction: 'AE-ADGM',
        targetJurisdiction: 'EU-GDPR',
        dataCategories: ['biometric'],
        dataSubjectId: 'subject-1',
        purpose: 'remote_onboarding',
        legalBasis: 'standard_contractual_clauses',
        recipientInfo: {
          organizationName: 'Verifier GmbH',
        },
      },
      {
        transferId: 'transfer-1',
        allowed: true,
        legalBasis: 'standard_contractual_clauses',
        requiredSafeguards: ['encryption_at_rest'],
        riskLevel: 'high',
        conditions: [],
        regulatoryNotifications: [],
        expiresAt: '2026-12-31T00:00:00.000Z',
      },
    );

    expect(outcome.result).toMatchObject({
      allowed: false,
      riskLevel: 'prohibited',
      policyDecision: 'blocked',
    });
    expect(outcome.result.policyAlerts).toEqual(
      expect.arrayContaining([
        'Policy prohibits transfers from AE-ADGM to EU-GDPR',
        'Policy disallows transferring categories: biometric',
        'Policy requires legal basis binding_corporate_rules for this transfer',
      ]),
    );
    expect(outcome.result.requiredSafeguards).toEqual(
      expect.arrayContaining(['encryption_at_rest', 'customer_managed_keys']),
    );
    expect(outcome.trace).toMatchObject({
      policyDefinitionId: 'policy-transfer-1',
      directives: expect.arrayContaining([
        'prohibited_jurisdiction_pairs',
        'disallowed_data_categories',
        'required_legal_basis',
        'required_safeguards',
        'risk_review_levels',
      ]),
    });
  });

  it('applies reporting policy directives to generated reports', async () => {
    mockPolicyDefinitionFindFirst.mockResolvedValue({
      id: 'policy-reporting-1',
      name: 'regulatory_reporting',
      version: '2026.07.0',
      definition: {
        execution: {
          forcePendingReviewForReportTypes: ['SAR'],
          requiredRequestFieldsByReportType: {
            SAR: ['filingInstitution.contactPhone', 'subject.address'],
          },
          forcePendingReviewOnPriorities: ['high'],
        },
      },
    });

    const outcome = await policyExecutionService.applyReportingPolicy(
      'org-1',
      {
        policyName: 'regulatory_reporting',
        policyVersion: '2026.07.0',
        policyDefinitionId: 'policy-reporting-1',
        policyReference: 'zeroid://policy/org/org-1/regulatory_reporting@2026.07.0',
        policyFamily: 'reporting',
      },
      {
        reportType: 'SAR',
        priority: 'high',
        filingInstitution: {
          name: 'Aethelred Bank',
          registrationNumber: 'AB-1',
          jurisdiction: 'AE-ADGM',
          contactName: 'Compliance Officer',
          contactEmail: 'compliance@example.com',
        },
        subject: {
          entityId: 'entity-1',
          name: 'John Doe',
        },
      },
      {
        reportId: 'report-1',
        reportType: 'SAR',
        version: 1,
        status: 'draft',
        filingJurisdiction: 'AE-ADGM',
        generatedAt: '2026-04-21T00:00:00.000Z',
        submittedAt: null,
        expiresAt: '2026-05-21T00:00:00.000Z',
        content: {},
        amendments: [],
        filingReference: null,
        exportFormats: ['json', 'xml', 'pdf'],
      },
    );

    expect(outcome.result).toMatchObject({
      status: 'pending_review',
      policyDecision: 'review_required',
    });
    expect(outcome.result.policyAlerts).toEqual(
      expect.arrayContaining([
        'Policy requires pending review for SAR reports',
        'Policy requires additional report inputs: filingInstitution.contactPhone, subject.address',
        'Policy requires pending review for high priority reports',
      ]),
    );
    expect(outcome.trace).toMatchObject({
      policyDefinitionId: 'policy-reporting-1',
      directives: expect.arrayContaining([
        'pending_review_report_types',
        'required_request_fields',
        'priority_review_gate',
      ]),
    });
  });

  it('applies privacy policy directives to DSAR and erasure workflows', async () => {
    mockPolicyDefinitionFindFirst.mockResolvedValue({
      id: 'policy-privacy-1',
      name: 'data_subject_access',
      version: '2026.07.0',
      definition: {
        execution: {
          forcePendingReviewOnRequestTypes: ['access'],
          requiredDataCategoriesByRequestType: {
            access: ['personal_data', 'processing_activities'],
          },
          requireRetentionOverridesForErasureCategories: ['financial_data'],
        },
      },
    });

    const dsarOutcome = await policyExecutionService.applyPrivacyWorkflowPolicy(
      'org-1',
      {
        policyName: 'data_subject_access',
        policyVersion: '2026.07.0',
        policyDefinitionId: 'policy-privacy-1',
        policyReference: 'zeroid://policy/org/org-1/data_subject_access@2026.07.0',
        policyFamily: 'privacy',
      },
      'dsar',
      {
        requestType: 'access',
        dataCategories: ['personal_data'],
      },
      {
        reportId: 'report-dsar-1',
        reportType: 'DSAR',
        version: 1,
        status: 'draft',
        filingJurisdiction: 'EU-GDPR',
        generatedAt: '2026-04-21T00:00:00.000Z',
        submittedAt: null,
        expiresAt: '2026-05-21T00:00:00.000Z',
        content: {},
        amendments: [],
        filingReference: null,
        exportFormats: ['json'],
      },
    );

    expect(dsarOutcome.result).toMatchObject({
      status: 'pending_review',
      policyDecision: 'review_required',
    });
    expect(dsarOutcome.result.policyAlerts).toEqual(
      expect.arrayContaining([
        'Policy requires pending review for access privacy requests',
        'Policy requires additional privacy request categories: processing_activities',
      ]),
    );
    expect(dsarOutcome.trace).toMatchObject({
      policyDefinitionId: 'policy-privacy-1',
      directives: expect.arrayContaining([
        'privacy_request_review_gate',
        'required_privacy_data_categories',
        'required_retention_overrides',
      ]),
    });

    const erasureOutcome = await policyExecutionService.applyPrivacyWorkflowPolicy(
      'org-1',
      {
        policyName: 'data_subject_erasure',
        policyVersion: '2026.07.0',
        policyDefinitionId: 'policy-privacy-1',
        policyReference: 'zeroid://policy/org/org-1/data_subject_erasure@2026.07.0',
        policyFamily: 'privacy',
      },
      'erasure',
      {
        requestType: 'erasure',
        dataCategories: ['financial_data'],
        retentionOverrides: [],
      },
      {
        reportId: 'report-erasure-1',
        reportType: 'ERASURE',
        version: 1,
        status: 'submitted',
        filingJurisdiction: 'EU-GDPR',
        generatedAt: '2026-04-21T00:00:00.000Z',
        submittedAt: '2026-04-21T00:00:00.000Z',
        expiresAt: null,
        content: {},
        amendments: [],
        filingReference: null,
        exportFormats: ['json'],
      },
    );

    expect(erasureOutcome.result).toMatchObject({
      status: 'pending_review',
      policyDecision: 'review_required',
    });
    expect(erasureOutcome.result.policyAlerts).toEqual(
      expect.arrayContaining([
        'Policy requires retention overrides for erasure categories: financial_data',
      ]),
    );
  });

  it('applies privacy policy directives to PIA and breach workflows', async () => {
    mockPolicyDefinitionFindFirst.mockResolvedValue({
      id: 'policy-privacy-2',
      name: 'privacy_impact_assessment',
      version: '2026.07.0',
      definition: {
        execution: {
          forceSupervisoryConsultationRiskLevels: ['high'],
          requireProcessorDpas: true,
          forcePendingReviewOnCrossBorderPIA: true,
          forceSubjectNotificationSeverities: ['high'],
          acceleratedBreachDeadlineHours: 24,
        },
      },
    });

    const piaOutcome = await policyExecutionService.applyPrivacyWorkflowPolicy(
      'org-1',
      {
        policyName: 'privacy_impact_assessment',
        policyVersion: '2026.07.0',
        policyDefinitionId: 'policy-privacy-2',
        policyReference: 'zeroid://policy/org/org-1/privacy_impact_assessment@2026.07.0',
        policyFamily: 'privacy',
      },
      'pia',
      {
        projectName: 'ZeroID Access',
        description: 'Cross-border identity verification workflow',
        dataCategories: ['biometric'],
        processingPurposes: ['identity_verification'],
        dataSubjectCategories: ['general_public'],
        jurisdictions: ['EU-GDPR'],
        thirdPartyProcessors: [
          {
            name: 'Processor One',
            role: 'processor',
            jurisdiction: 'EU-GDPR',
            dpaInPlace: false,
          },
        ],
        automaticDecisionMaking: true,
        crossBorderTransfer: true,
      },
      {
        assessmentId: 'pia-1',
        riskScore: 60,
        riskLevel: 'high',
        findings: [],
        dpaRequired: true,
        dpiaRequired: true,
        supervisoryConsultationRequired: false,
        recommendations: [],
        completedAt: '2026-04-21T00:00:00.000Z',
      },
    );

    expect(piaOutcome.result).toMatchObject({
      supervisoryConsultationRequired: true,
      policyDecision: 'review_required',
    });
    expect(piaOutcome.result.policyAlerts).toEqual(
      expect.arrayContaining([
        'Policy requires supervisory consultation for high risk PIAs',
        'Policy requires signed DPAs for all third-party processors',
        'Policy requires review for PIAs involving cross-border transfers',
      ]),
    );

    const breachOutcome = await policyExecutionService.applyPrivacyWorkflowPolicy(
      'org-1',
      {
        policyName: 'data_breach_notification',
        policyVersion: '2026.07.0',
        policyDefinitionId: 'policy-privacy-2',
        policyReference: 'zeroid://policy/org/org-1/data_breach_notification@2026.07.0',
        policyFamily: 'privacy',
      },
      'breach',
      {
        detectedAt: '2026-04-21T00:00:00.000Z',
        description: 'Unauthorized access to identity verification logs',
        severity: 'high',
        dataCategories: ['personal_data'],
        estimatedAffected: 120,
        jurisdictions: ['EU-GDPR'],
        containmentActions: ['Rotated keys'],
      },
      {
        breachId: 'breach-1',
        regulatoryDeadlines: [
          {
            jurisdiction: 'EU-GDPR',
            authority: 'Data Protection Authority',
            deadlineHours: 72,
            deadline: '2026-04-24T00:00:00.000Z',
            notificationSent: false,
            sentAt: null,
          },
        ],
        dataSubjectNotificationRequired: false,
        dataSubjectDeadlineHours: 0,
      },
    );

    expect(breachOutcome.result).toMatchObject({
      dataSubjectNotificationRequired: true,
      dataSubjectDeadlineHours: 72,
      policyDecision: 'review_required',
    });
    expect(breachOutcome.result.regulatoryDeadlines[0]).toMatchObject({
      deadlineHours: 24,
    });
    expect(breachOutcome.result.policyAlerts).toEqual(
      expect.arrayContaining([
        'Policy requires data subject notification for high severity breaches',
        'Policy accelerates breach escalation to 24 hours for one or more jurisdictions',
      ]),
    );
    expect(breachOutcome.trace).toMatchObject({
      policyDefinitionId: 'policy-privacy-2',
      directives: expect.arrayContaining([
        'supervisory_consultation_risk_levels',
        'processor_dpa_requirement',
        'cross_border_pia_review_gate',
        'breach_subject_notification_gate',
        'accelerated_breach_deadlines',
      ]),
    });
  });
});
