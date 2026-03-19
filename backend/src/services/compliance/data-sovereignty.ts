import { z } from "zod";
import { createLogger, format, transports } from "winston";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const logger = createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { service: "data-sovereignty" },
  transports: [new transports.Console()],
});

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------
export const DataResidencyRuleSchema = z.object({
  jurisdiction: z.string(),
  dataCategory: z.enum([
    "personal",
    "financial",
    "biometric",
    "health",
    "criminal",
    "credential",
    "metadata",
  ]),
  storageRegion: z.string(),
  encryptionRequired: z.boolean(),
  encryptionStandard: z
    .enum(["AES-256-GCM", "AES-256-CBC", "ChaCha20-Poly1305"])
    .default("AES-256-GCM"),
  localKeyManagement: z.boolean(),
  replicationAllowed: z.boolean(),
  replicationRegions: z.array(z.string()).default([]),
});

export type DataResidencyRule = z.infer<typeof DataResidencyRuleSchema>;

export const CrossBorderTransferSchema = z.object({
  transferId: z.string().optional(),
  sourceJurisdiction: z.string(),
  targetJurisdiction: z.string(),
  dataCategories: z.array(
    z.enum([
      "personal",
      "financial",
      "biometric",
      "health",
      "criminal",
      "credential",
      "metadata",
    ]),
  ),
  dataSubjectId: z.string(),
  purpose: z.string(),
  legalBasis: z
    .enum([
      "adequacy_decision",
      "standard_contractual_clauses",
      "binding_corporate_rules",
      "explicit_consent",
      "vital_interests",
      "public_interest",
      "legal_claims",
    ])
    .optional(),
  recipientInfo: z.object({
    organizationName: z.string(),
    dataProtectionOfficer: z.string().optional(),
    safeguards: z.array(z.string()).default([]),
  }),
});

export type CrossBorderTransfer = z.infer<typeof CrossBorderTransferSchema>;

export const ConsentRecordSchema = z.object({
  consentId: z.string().optional(),
  dataSubjectId: z.string(),
  purposes: z.array(
    z.object({
      purposeId: z.string(),
      name: z.string(),
      description: z.string(),
      legalBasis: z.enum([
        "consent",
        "contract",
        "legal_obligation",
        "vital_interests",
        "public_task",
        "legitimate_interests",
      ]),
      dataCategories: z.array(z.string()),
      retentionDays: z.number().int().positive(),
    }),
  ),
  consentGiven: z.boolean(),
  collectedAt: z.string().datetime(),
  collectionMethod: z.enum([
    "explicit_form",
    "api",
    "in_app",
    "verbal",
    "written",
  ]),
  jurisdiction: z.string(),
  withdrawable: z.boolean().default(true),
});

export type ConsentRecord = z.infer<typeof ConsentRecordSchema>;

export const PIASchema = z.object({
  assessmentId: z.string().optional(),
  projectName: z.string(),
  description: z.string(),
  dataCategories: z.array(z.string()),
  processingPurposes: z.array(z.string()),
  dataSubjectCategories: z.array(
    z.enum([
      "employees",
      "customers",
      "minors",
      "vulnerable_persons",
      "general_public",
    ]),
  ),
  jurisdictions: z.array(z.string()),
  thirdPartyProcessors: z
    .array(
      z.object({
        name: z.string(),
        role: z.enum(["processor", "sub_processor", "joint_controller"]),
        jurisdiction: z.string(),
        dpaInPlace: z.boolean(),
      }),
    )
    .default([]),
  automaticDecisionMaking: z.boolean().default(false),
  crossBorderTransfer: z.boolean().default(false),
});

export type PIA = z.infer<typeof PIASchema>;

export const BreachNotificationSchema = z.object({
  breachId: z.string().optional(),
  detectedAt: z.string().datetime(),
  description: z.string().min(20),
  severity: z.enum(["critical", "high", "medium", "low"]),
  dataCategories: z.array(z.string()),
  estimatedAffected: z.number().int().positive(),
  jurisdictions: z.array(z.string()),
  containmentActions: z.array(z.string()),
  rootCause: z.string().optional(),
});

export type BreachNotification = z.infer<typeof BreachNotificationSchema>;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------
export interface TransferAssessmentResult {
  transferId: string;
  allowed: boolean;
  legalBasis: string | null;
  requiredSafeguards: string[];
  riskLevel: "low" | "medium" | "high" | "prohibited";
  conditions: string[];
  regulatoryNotifications: string[];
  expiresAt: string;
}

export interface PIAResult {
  assessmentId: string;
  riskScore: number;
  riskLevel: "low" | "medium" | "high" | "very_high";
  findings: Array<{
    area: string;
    risk: string;
    severity: string;
    mitigation: string;
  }>;
  dpaRequired: boolean;
  dpiaRequired: boolean;
  supervisoryConsultationRequired: boolean;
  recommendations: string[];
  completedAt: string;
}

export interface BreachTimeline {
  breachId: string;
  regulatoryDeadlines: Array<{
    jurisdiction: string;
    authority: string;
    deadlineHours: number;
    deadline: string;
    notificationSent: boolean;
    sentAt: string | null;
  }>;
  dataSubjectNotificationRequired: boolean;
  dataSubjectDeadlineHours: number;
}

export interface RetentionStatus {
  dataSubjectId: string;
  records: Array<{
    category: string;
    jurisdiction: string;
    retentionDays: number;
    createdAt: string;
    expiresAt: string;
    expired: boolean;
    autoDeleteScheduled: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Adequacy decisions map (EU-recognized jurisdictions)
// ---------------------------------------------------------------------------
const EU_ADEQUACY_DECISIONS: Set<string> = new Set([
  "AD",
  "AR",
  "CA",
  "FO",
  "GG",
  "IL",
  "IM",
  "JP",
  "JE",
  "NZ",
  "KR",
  "CH",
  "GB",
  "UY",
  "US",
]);

// ---------------------------------------------------------------------------
// Data residency rules per jurisdiction
// ---------------------------------------------------------------------------
const DEFAULT_RESIDENCY_RULES: DataResidencyRule[] = [
  {
    jurisdiction: "AE-CBUAE",
    dataCategory: "personal",
    storageRegion: "me-central-1",
    encryptionRequired: true,
    encryptionStandard: "AES-256-GCM",
    localKeyManagement: true,
    replicationAllowed: false,
    replicationRegions: [],
  },
  {
    jurisdiction: "AE-CBUAE",
    dataCategory: "financial",
    storageRegion: "me-central-1",
    encryptionRequired: true,
    encryptionStandard: "AES-256-GCM",
    localKeyManagement: true,
    replicationAllowed: false,
    replicationRegions: [],
  },
  {
    jurisdiction: "AE-CBUAE",
    dataCategory: "biometric",
    storageRegion: "me-central-1",
    encryptionRequired: true,
    encryptionStandard: "AES-256-GCM",
    localKeyManagement: true,
    replicationAllowed: false,
    replicationRegions: [],
  },
  {
    jurisdiction: "EU-GDPR",
    dataCategory: "personal",
    storageRegion: "eu-west-1",
    encryptionRequired: true,
    encryptionStandard: "AES-256-GCM",
    localKeyManagement: false,
    replicationAllowed: true,
    replicationRegions: ["eu-central-1", "eu-north-1"],
  },
  {
    jurisdiction: "EU-GDPR",
    dataCategory: "biometric",
    storageRegion: "eu-west-1",
    encryptionRequired: true,
    encryptionStandard: "AES-256-GCM",
    localKeyManagement: true,
    replicationAllowed: false,
    replicationRegions: [],
  },
  {
    jurisdiction: "SA-SAMA",
    dataCategory: "personal",
    storageRegion: "me-south-1",
    encryptionRequired: true,
    encryptionStandard: "AES-256-GCM",
    localKeyManagement: true,
    replicationAllowed: false,
    replicationRegions: [],
  },
  {
    jurisdiction: "SA-SAMA",
    dataCategory: "financial",
    storageRegion: "me-south-1",
    encryptionRequired: true,
    encryptionStandard: "AES-256-GCM",
    localKeyManagement: true,
    replicationAllowed: false,
    replicationRegions: [],
  },
  {
    jurisdiction: "SG-MAS",
    dataCategory: "personal",
    storageRegion: "ap-southeast-1",
    encryptionRequired: true,
    encryptionStandard: "AES-256-GCM",
    localKeyManagement: false,
    replicationAllowed: true,
    replicationRegions: ["ap-southeast-2"],
  },
  {
    jurisdiction: "UK-FCA",
    dataCategory: "personal",
    storageRegion: "eu-west-2",
    encryptionRequired: true,
    encryptionStandard: "AES-256-GCM",
    localKeyManagement: false,
    replicationAllowed: true,
    replicationRegions: ["eu-west-1"],
  },
  {
    jurisdiction: "BH-CBB",
    dataCategory: "personal",
    storageRegion: "me-central-1",
    encryptionRequired: true,
    encryptionStandard: "AES-256-GCM",
    localKeyManagement: true,
    replicationAllowed: false,
    replicationRegions: [],
  },
];

// ---------------------------------------------------------------------------
// DataSovereigntyService
// ---------------------------------------------------------------------------
export class DataSovereigntyService {
  private residencyRules: DataResidencyRule[] = [...DEFAULT_RESIDENCY_RULES];
  private consentRecords: Map<string, ConsentRecord[]> = new Map();
  private transferAssessments: Map<string, TransferAssessmentResult> =
    new Map();
  private piaResults: Map<string, PIAResult> = new Map();
  private breachRecords: Map<string, BreachTimeline> = new Map();
  private retentionTracker: Map<string, RetentionStatus> = new Map();
  private dpaRegistry: Map<
    string,
    {
      processor: string;
      jurisdiction: string;
      signedAt: string;
      expiresAt: string;
    }
  > = new Map();

  constructor() {
    logger.info("DataSovereigntyService initialized", {
      residencyRules: this.residencyRules.length,
    });
  }

  // -------------------------------------------------------------------------
  // Data residency enforcement
  // -------------------------------------------------------------------------
  getResidencyRules(
    jurisdiction: string,
    dataCategory?: string,
  ): DataResidencyRule[] {
    return this.residencyRules.filter(
      (r) =>
        r.jurisdiction === jurisdiction &&
        (!dataCategory || r.dataCategory === dataCategory),
    );
  }

  enforceResidency(
    jurisdiction: string,
    dataCategory: string,
    targetRegion: string,
  ): {
    compliant: boolean;
    requiredRegion: string | null;
    encryptionRequired: boolean;
    encryptionStandard: string;
    violations: string[];
  } {
    const rules = this.getResidencyRules(jurisdiction, dataCategory);
    if (rules.length === 0) {
      return {
        compliant: true,
        requiredRegion: null,
        encryptionRequired: false,
        encryptionStandard: "AES-256-GCM",
        violations: [],
      };
    }

    const rule = rules[0];
    const violations: string[] = [];
    const primaryMatch = targetRegion === rule.storageRegion;
    const replicaMatch =
      rule.replicationAllowed && rule.replicationRegions.includes(targetRegion);

    if (!primaryMatch && !replicaMatch) {
      violations.push(
        `Data must be stored in ${rule.storageRegion}, not ${targetRegion}`,
      );
    }

    return {
      compliant: violations.length === 0,
      requiredRegion: rule.storageRegion,
      encryptionRequired: rule.encryptionRequired,
      encryptionStandard: rule.encryptionStandard,
      violations,
    };
  }

  // -------------------------------------------------------------------------
  // Cross-border data transfer assessment
  // -------------------------------------------------------------------------
  assessCrossBorderTransfer(
    transfer: CrossBorderTransfer,
  ): TransferAssessmentResult {
    const parsed = CrossBorderTransferSchema.parse(transfer);
    const transferId = parsed.transferId ?? crypto.randomUUID();

    const sourceCountry = parsed.sourceJurisdiction.split("-")[0];
    const targetCountry = parsed.targetJurisdiction.split("-")[0];
    const isEuSource = ["EU", "DE", "FR", "IT", "ES", "NL"].includes(
      sourceCountry,
    );
    const isEuTarget = ["EU", "DE", "FR", "IT", "ES", "NL"].includes(
      targetCountry,
    );

    const requiredSafeguards: string[] = [];
    const conditions: string[] = [];
    const regulatoryNotifications: string[] = [];
    let legalBasis = parsed.legalBasis ?? null;
    let riskLevel: TransferAssessmentResult["riskLevel"] = "low";

    // EU outbound transfer rules (GDPR Chapter V)
    if (isEuSource && !isEuTarget) {
      if (EU_ADEQUACY_DECISIONS.has(targetCountry)) {
        legalBasis = legalBasis ?? "adequacy_decision";
        riskLevel = "low";
      } else {
        legalBasis = legalBasis ?? "standard_contractual_clauses";
        requiredSafeguards.push("Standard Contractual Clauses (EU 2021/914)");
        requiredSafeguards.push("Transfer Impact Assessment required");
        riskLevel = "medium";
        conditions.push(
          "Recipient must demonstrate equivalent data protection",
        );
      }

      if (
        parsed.dataCategories.includes("biometric") ||
        parsed.dataCategories.includes("health")
      ) {
        riskLevel = "high";
        requiredSafeguards.push(
          "Explicit consent of data subject for special categories",
        );
        requiredSafeguards.push(
          "Additional technical measures (pseudonymization/encryption)",
        );
        regulatoryNotifications.push(
          "DPA notification may be required for Art. 9 data transfer",
        );
      }
    }

    // UAE data localization
    if (sourceCountry === "AE") {
      const sensitiveCats = parsed.dataCategories.filter((c) =>
        ["biometric", "health", "criminal"].includes(c),
      );
      if (sensitiveCats.length > 0) {
        riskLevel = "high";
        requiredSafeguards.push(
          "UAE PDPL consent for sensitive data cross-border transfer",
        );
        conditions.push(
          "Adequate protection level in target jurisdiction required",
        );
      }
    }

    // Saudi restrictions
    if (sourceCountry === "SA") {
      riskLevel = riskLevel === "low" ? "medium" : riskLevel;
      requiredSafeguards.push("SAMA approval for financial data transfers");
      conditions.push("Data must not include classified government data");
      regulatoryNotifications.push(
        "NDMO notification required for personal data transfer",
      );
    }

    const allowed = (riskLevel as string) !== "prohibited";

    const result: TransferAssessmentResult = {
      transferId,
      allowed,
      legalBasis,
      requiredSafeguards,
      riskLevel,
      conditions,
      regulatoryNotifications,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    };

    this.transferAssessments.set(transferId, result);
    logger.info("transfer_assessment_complete", {
      transferId,
      allowed,
      riskLevel,
      legalBasis,
    });
    return result;
  }

  // -------------------------------------------------------------------------
  // Consent management
  // -------------------------------------------------------------------------
  recordConsent(consent: ConsentRecord): ConsentRecord & { consentId: string } {
    const parsed = ConsentRecordSchema.parse(consent);
    const consentId = parsed.consentId ?? crypto.randomUUID();
    const record = { ...parsed, consentId };

    const existing = this.consentRecords.get(parsed.dataSubjectId) ?? [];
    existing.push(record);
    this.consentRecords.set(parsed.dataSubjectId, existing);

    logger.info("consent_recorded", {
      consentId,
      dataSubjectId: parsed.dataSubjectId,
      purposes: parsed.purposes.map((p) => p.purposeId),
      given: parsed.consentGiven,
    });

    return record;
  }

  withdrawConsent(
    dataSubjectId: string,
    purposeId: string,
  ): { withdrawn: boolean; affectedRecords: number } {
    const records = this.consentRecords.get(dataSubjectId) ?? [];
    let affected = 0;

    for (const record of records) {
      if (record.withdrawable) {
        const purposeIndex = record.purposes.findIndex(
          (p) => p.purposeId === purposeId,
        );
        if (purposeIndex >= 0) {
          record.purposes.splice(purposeIndex, 1);
          affected++;
        }
        if (record.purposes.length === 0) {
          record.consentGiven = false;
        }
      }
    }

    logger.info("consent_withdrawn", {
      dataSubjectId,
      purposeId,
      affectedRecords: affected,
    });
    return { withdrawn: affected > 0, affectedRecords: affected };
  }

  getConsents(dataSubjectId: string): ConsentRecord[] {
    return this.consentRecords.get(dataSubjectId) ?? [];
  }

  // -------------------------------------------------------------------------
  // Data minimization enforcement
  // -------------------------------------------------------------------------
  enforceMinimization(
    requestedFields: string[],
    purpose: string,
    jurisdiction: string,
  ): {
    allowedFields: string[];
    deniedFields: string[];
    reason: string;
  } {
    const minimizationRules: Record<string, string[]> = {
      identity_verification: [
        "full_name",
        "date_of_birth",
        "nationality",
        "document_number",
        "document_type",
        "photo",
      ],
      age_verification: ["date_of_birth"],
      address_verification: [
        "full_name",
        "address_line1",
        "address_line2",
        "city",
        "postal_code",
        "country",
      ],
      accreditation_check: [
        "full_name",
        "accreditation_status",
        "accreditation_date",
      ],
      transaction_monitoring: [
        "entity_id",
        "transaction_amount",
        "transaction_date",
        "counterparty_id",
      ],
    };

    const allowedForPurpose = minimizationRules[purpose] ?? requestedFields;
    const allowedFields = requestedFields.filter((f) =>
      allowedForPurpose.includes(f),
    );
    const deniedFields = requestedFields.filter(
      (f) => !allowedForPurpose.includes(f),
    );

    logger.info("minimization_enforced", {
      purpose,
      jurisdiction,
      requested: requestedFields.length,
      allowed: allowedFields.length,
      denied: deniedFields.length,
    });

    return {
      allowedFields,
      deniedFields,
      reason:
        deniedFields.length > 0
          ? `Fields not necessary for purpose "${purpose}" under data minimization principle`
          : "All fields permitted for stated purpose",
    };
  }

  // -------------------------------------------------------------------------
  // Privacy Impact Assessment (PIA) automation
  // -------------------------------------------------------------------------
  conductPIA(pia: PIA): PIAResult {
    const parsed = PIASchema.parse(pia);
    const assessmentId = parsed.assessmentId ?? crypto.randomUUID();

    const findings: PIAResult["findings"] = [];
    let riskScore = 0;

    // Sensitive data categories
    const sensitiveCategories = parsed.dataCategories.filter((c) =>
      ["biometric", "health", "criminal"].includes(c),
    );
    if (sensitiveCategories.length > 0) {
      riskScore += 30;
      findings.push({
        area: "Special Category Data",
        risk: `Processing special category data: ${sensitiveCategories.join(", ")}`,
        severity: "high",
        mitigation:
          "Ensure GDPR Art. 9 lawful basis. Implement additional encryption and access controls.",
      });
    }

    // Vulnerable data subjects
    if (
      parsed.dataSubjectCategories.includes("minors") ||
      parsed.dataSubjectCategories.includes("vulnerable_persons")
    ) {
      riskScore += 25;
      findings.push({
        area: "Vulnerable Data Subjects",
        risk: "Processing data of minors or vulnerable persons",
        severity: "high",
        mitigation:
          "Implement age verification. Obtain parental consent where applicable.",
      });
    }

    // Automatic decision making
    if (parsed.automaticDecisionMaking) {
      riskScore += 20;
      findings.push({
        area: "Automated Decision-Making",
        risk: "GDPR Art. 22 automated individual decision-making",
        severity: "medium",
        mitigation:
          "Provide opt-out mechanism. Implement human review process.",
      });
    }

    // Cross-border transfer
    if (parsed.crossBorderTransfer) {
      riskScore += 15;
      findings.push({
        area: "Cross-Border Transfer",
        risk: "Data transferred across jurisdictions",
        severity: "medium",
        mitigation: "Ensure adequate safeguards per GDPR Chapter V.",
      });
    }

    // Third-party processors without DPA
    const processorsWithoutDPA = parsed.thirdPartyProcessors.filter(
      (p) => !p.dpaInPlace,
    );
    if (processorsWithoutDPA.length > 0) {
      riskScore += 20;
      findings.push({
        area: "Data Processing Agreements",
        risk: `${processorsWithoutDPA.length} processor(s) without Data Processing Agreement`,
        severity: "high",
        mitigation:
          "Execute DPAs with all processors before data sharing. Ensure GDPR Art. 28 compliance.",
      });
    }

    // Scale assessment
    if (parsed.dataSubjectCategories.includes("general_public")) {
      riskScore += 10;
      findings.push({
        area: "Large-Scale Processing",
        risk: "Processing data of the general public at scale",
        severity: "medium",
        mitigation: "Ensure proportionality. Implement data minimization.",
      });
    }

    const riskLevel: PIAResult["riskLevel"] =
      riskScore >= 75
        ? "very_high"
        : riskScore >= 50
          ? "high"
          : riskScore >= 25
            ? "medium"
            : "low";
    const dpiaRequired =
      riskScore >= 50 ||
      sensitiveCategories.length > 0 ||
      parsed.automaticDecisionMaking;
    const supervisoryConsultationRequired = riskScore >= 75;

    const recommendations: string[] = [];
    if (dpiaRequired)
      recommendations.push(
        "Conduct full DPIA before proceeding with processing",
      );
    if (processorsWithoutDPA.length > 0)
      recommendations.push("Execute DPAs with all data processors");
    if (parsed.crossBorderTransfer)
      recommendations.push("Complete Transfer Impact Assessment");
    if (findings.length === 0)
      recommendations.push("No significant privacy risks identified");

    const result: PIAResult = {
      assessmentId,
      riskScore: Math.min(100, riskScore),
      riskLevel,
      findings,
      dpaRequired: parsed.thirdPartyProcessors.length > 0,
      dpiaRequired,
      supervisoryConsultationRequired,
      recommendations,
      completedAt: new Date().toISOString(),
    };

    this.piaResults.set(assessmentId, result);
    logger.info("pia_completed", {
      assessmentId,
      riskScore: result.riskScore,
      riskLevel,
      dpiaRequired,
    });
    return result;
  }

  // -------------------------------------------------------------------------
  // DPA tracking
  // -------------------------------------------------------------------------
  registerDPA(
    processorName: string,
    jurisdiction: string,
    expiresInDays: number,
  ): { dpaId: string } {
    const dpaId = crypto.randomUUID();
    this.dpaRegistry.set(dpaId, {
      processor: processorName,
      jurisdiction,
      signedAt: new Date().toISOString(),
      expiresAt: new Date(
        Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
      ).toISOString(),
    });
    logger.info("dpa_registered", { dpaId, processor: processorName });
    return { dpaId };
  }

  // -------------------------------------------------------------------------
  // Breach notification workflow
  // -------------------------------------------------------------------------
  initiateBreachNotification(breach: BreachNotification): BreachTimeline {
    const parsed = BreachNotificationSchema.parse(breach);
    const breachId = parsed.breachId ?? crypto.randomUUID();
    const detectedTime = new Date(parsed.detectedAt).getTime();

    const deadlineMap: Record<string, { authority: string; hours: number }> = {
      "EU-GDPR": { authority: "Data Protection Authority", hours: 72 },
      "AE-CBUAE": { authority: "UAE CBUAE", hours: 72 },
      "UK-FCA": { authority: "ICO", hours: 72 },
      "SA-SAMA": { authority: "NDMO / SAMA", hours: 72 },
      "SG-MAS": { authority: "PDPC", hours: 72 },
      "US-FINCEN": { authority: "State AG / HHS", hours: 720 },
      "US-CA": { authority: "California AG", hours: 720 },
      "BH-CBB": { authority: "CBB", hours: 48 },
    };

    const regulatoryDeadlines = parsed.jurisdictions.map((j) => {
      const rule = deadlineMap[j] ?? { authority: `${j} Authority`, hours: 72 };
      return {
        jurisdiction: j,
        authority: rule.authority,
        deadlineHours: rule.hours,
        deadline: new Date(
          detectedTime + rule.hours * 60 * 60 * 1000,
        ).toISOString(),
        notificationSent: false,
        sentAt: null,
      };
    });

    const subjectNotificationRequired =
      parsed.severity === "critical" || parsed.severity === "high";

    const timeline: BreachTimeline = {
      breachId,
      regulatoryDeadlines,
      dataSubjectNotificationRequired: subjectNotificationRequired,
      dataSubjectDeadlineHours: subjectNotificationRequired ? 168 : 0,
    };

    this.breachRecords.set(breachId, timeline);
    logger.warn("breach_notification_initiated", {
      breachId,
      severity: parsed.severity,
      jurisdictions: parsed.jurisdictions,
      estimatedAffected: parsed.estimatedAffected,
    });

    return timeline;
  }

  getBreachTimeline(breachId: string): BreachTimeline | null {
    return this.breachRecords.get(breachId) ?? null;
  }

  // -------------------------------------------------------------------------
  // Data retention policy enforcement
  // -------------------------------------------------------------------------
  trackRetention(
    dataSubjectId: string,
    category: string,
    jurisdiction: string,
    retentionDays: number,
  ): void {
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + retentionDays * 24 * 60 * 60 * 1000,
    );

    const status = this.retentionTracker.get(dataSubjectId) ?? {
      dataSubjectId,
      records: [],
    };
    status.records.push({
      category,
      jurisdiction,
      retentionDays,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      expired: false,
      autoDeleteScheduled: true,
    });
    this.retentionTracker.set(dataSubjectId, status);

    logger.info("retention_tracked", {
      dataSubjectId,
      category,
      jurisdiction,
      retentionDays,
      expiresAt: expiresAt.toISOString(),
    });
  }

  getRetentionStatus(dataSubjectId: string): RetentionStatus | null {
    const status = this.retentionTracker.get(dataSubjectId);
    if (!status) return null;

    const now = Date.now();
    for (const record of status.records) {
      record.expired = new Date(record.expiresAt).getTime() <= now;
    }
    return status;
  }

  getExpiredRecords(): Array<{
    dataSubjectId: string;
    category: string;
    expiresAt: string;
  }> {
    const expired: Array<{
      dataSubjectId: string;
      category: string;
      expiresAt: string;
    }> = [];
    const now = Date.now();

    for (const [subjectId, status] of this.retentionTracker) {
      for (const record of status.records) {
        if (new Date(record.expiresAt).getTime() <= now && !record.expired) {
          expired.push({
            dataSubjectId: subjectId,
            category: record.category,
            expiresAt: record.expiresAt,
          });
        }
      }
    }

    return expired;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
export const dataSovereigntyService = new DataSovereigntyService();
