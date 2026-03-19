/**
 * Jurisdiction Data and Rules
 *
 * Comprehensive jurisdiction definitions, per-jurisdiction credential
 * requirements, data retention rules, consent requirements, reporting
 * obligations, cross-border compatibility matrix, regulatory authority
 * metadata, and compliance scoring weights.
 */

// ============================================================================
// Types
// ============================================================================

export type JurisdictionId =
  | "uae"
  | "eu"
  | "us"
  | "sg"
  | "uk"
  | "bh"
  | "sa"
  | "hk"
  | "jp";

export interface JurisdictionDefinition {
  id: JurisdictionId;
  name: string;
  code: string;
  region: "mena" | "eu" | "americas" | "apac";
  regulatoryAuthority: string;
  authorityAcronym: string;
  authorityUrl: string;
  frameworks: string[];
  requiredCredentials: JurisdictionCredentialRequirement[];
  dataRetentionDays: number;
  consentRequirements: JurisdictionConsentRule[];
  reportingObligations: JurisdictionReportingObligation[];
  scoringWeights: ComplianceScoringWeights;
  kycLevel: number;
  specialConditions: string[];
}

export interface JurisdictionCredentialRequirement {
  schemaId: string;
  schemaName: string;
  mandatory: boolean;
  validityPeriodDays: number;
  acceptedIssuers: string[];
  renewalBufferDays: number;
}

export interface JurisdictionConsentRule {
  type: "explicit" | "implicit" | "opt_out";
  purpose: string;
  retentionDays: number;
  withdrawalEnabled: boolean;
  granularity: "per_attribute" | "per_credential" | "blanket";
}

export interface JurisdictionReportingObligation {
  type: string;
  frequency:
    | "real_time"
    | "daily"
    | "weekly"
    | "monthly"
    | "quarterly"
    | "annual";
  authority: string;
  format: string;
  thresholdAmount?: number;
  thresholdCurrency?: string;
  description: string;
}

export interface ComplianceScoringWeights {
  credentialCoverage: number;
  credentialFreshness: number;
  consentCompliance: number;
  reportingCompliance: number;
  dataResidency: number;
}

export interface CrossBorderCompatibility {
  score: number;
  restrictions: string[];
  bilateralAgreements: string[];
  additionalRequirements: string[];
}

// ============================================================================
// Jurisdiction Definitions
// ============================================================================

export const JURISDICTIONS: Record<JurisdictionId, JurisdictionDefinition> = {
  uae: {
    id: "uae",
    name: "United Arab Emirates",
    code: "AE",
    region: "mena",
    regulatoryAuthority: "Securities and Commodities Authority",
    authorityAcronym: "SCA",
    authorityUrl: "https://www.sca.gov.ae",
    frameworks: ["ADGM", "DIFC", "VARA", "CBUAE"],
    requiredCredentials: [
      {
        schemaId: "gov_id",
        schemaName: "Government ID (Emirates ID)",
        mandatory: true,
        validityPeriodDays: 1825,
        acceptedIssuers: ["did:aethelred:issuer:uae_ida"],
        renewalBufferDays: 90,
      },
      {
        schemaId: "kyc_aml",
        schemaName: "KYC/AML Verification",
        mandatory: true,
        validityPeriodDays: 365,
        acceptedIssuers: [],
        renewalBufferDays: 30,
      },
      {
        schemaId: "residency",
        schemaName: "UAE Residency Proof",
        mandatory: true,
        validityPeriodDays: 730,
        acceptedIssuers: [],
        renewalBufferDays: 60,
      },
      {
        schemaId: "sanctions_screen",
        schemaName: "Sanctions Screening",
        mandatory: true,
        validityPeriodDays: 90,
        acceptedIssuers: [],
        renewalBufferDays: 14,
      },
    ],
    dataRetentionDays: 1825,
    consentRequirements: [
      {
        type: "explicit",
        purpose: "identity_verification",
        retentionDays: 1825,
        withdrawalEnabled: false,
        granularity: "per_credential",
      },
      {
        type: "explicit",
        purpose: "transaction_monitoring",
        retentionDays: 1825,
        withdrawalEnabled: false,
        granularity: "blanket",
      },
    ],
    reportingObligations: [
      {
        type: "STR",
        frequency: "real_time",
        authority: "FIU",
        format: "goAML",
        thresholdAmount: 55000,
        thresholdCurrency: "AED",
        description:
          "Suspicious Transaction Report to Financial Intelligence Unit",
      },
      {
        type: "CTR",
        frequency: "daily",
        authority: "CBUAE",
        format: "XML",
        thresholdAmount: 55000,
        thresholdCurrency: "AED",
        description:
          "Cash Transaction Report for transactions above AED 55,000",
      },
    ],
    scoringWeights: {
      credentialCoverage: 0.35,
      credentialFreshness: 0.25,
      consentCompliance: 0.15,
      reportingCompliance: 0.15,
      dataResidency: 0.1,
    },
    kycLevel: 3,
    specialConditions: [
      "VARA registration required for virtual asset activities",
      "ADGM sandbox available for fintech testing",
    ],
  },

  eu: {
    id: "eu",
    name: "European Union",
    code: "EU",
    region: "eu",
    regulatoryAuthority: "European Securities and Markets Authority",
    authorityAcronym: "ESMA",
    authorityUrl: "https://www.esma.europa.eu",
    frameworks: ["MiCA", "GDPR", "eIDAS", "AMLD6", "DORA"],
    requiredCredentials: [
      {
        schemaId: "gov_id",
        schemaName: "EU National ID or Passport",
        mandatory: true,
        validityPeriodDays: 3650,
        acceptedIssuers: [],
        renewalBufferDays: 180,
      },
      {
        schemaId: "kyc_aml",
        schemaName: "KYC/AML (AMLD6 Compliant)",
        mandatory: true,
        validityPeriodDays: 365,
        acceptedIssuers: [],
        renewalBufferDays: 30,
      },
      {
        schemaId: "residency",
        schemaName: "EU Residency Proof",
        mandatory: false,
        validityPeriodDays: 365,
        acceptedIssuers: [],
        renewalBufferDays: 30,
      },
      {
        schemaId: "sanctions_screen",
        schemaName: "EU Sanctions Screening",
        mandatory: true,
        validityPeriodDays: 180,
        acceptedIssuers: [],
        renewalBufferDays: 30,
      },
      {
        schemaId: "eidas_qualified",
        schemaName: "eIDAS Qualified Certificate",
        mandatory: false,
        validityPeriodDays: 730,
        acceptedIssuers: [],
        renewalBufferDays: 60,
      },
    ],
    dataRetentionDays: 1825,
    consentRequirements: [
      {
        type: "explicit",
        purpose: "personal_data_processing",
        retentionDays: 1825,
        withdrawalEnabled: true,
        granularity: "per_attribute",
      },
      {
        type: "explicit",
        purpose: "cross_border_transfer",
        retentionDays: 1825,
        withdrawalEnabled: true,
        granularity: "per_credential",
      },
      {
        type: "explicit",
        purpose: "profiling",
        retentionDays: 365,
        withdrawalEnabled: true,
        granularity: "per_attribute",
      },
    ],
    reportingObligations: [
      {
        type: "SAR",
        frequency: "real_time",
        authority: "National FIU",
        format: "goAML",
        description: "Suspicious Activity Report per AMLD6",
      },
      {
        type: "DORA_Incident",
        frequency: "real_time",
        authority: "National Competent Authority",
        format: "DORA_XML",
        description: "ICT-related incident reporting under DORA",
      },
      {
        type: "MiCA_Report",
        frequency: "quarterly",
        authority: "ESMA",
        format: "XBRL",
        description: "Quarterly MiCA compliance reporting",
      },
    ],
    scoringWeights: {
      credentialCoverage: 0.3,
      credentialFreshness: 0.2,
      consentCompliance: 0.25,
      reportingCompliance: 0.15,
      dataResidency: 0.1,
    },
    kycLevel: 3,
    specialConditions: [
      "GDPR right to erasure must be supported",
      "Data must remain in EEA unless adequacy decision exists",
      "eIDAS Level of Assurance High for financial services",
    ],
  },

  us: {
    id: "us",
    name: "United States",
    code: "US",
    region: "americas",
    regulatoryAuthority: "Financial Crimes Enforcement Network",
    authorityAcronym: "FinCEN",
    authorityUrl: "https://www.fincen.gov",
    frameworks: ["BSA", "AML Act 2020", "OFAC", "SEC", "CFTC", "State MTL"],
    requiredCredentials: [
      {
        schemaId: "gov_id",
        schemaName: "US Government-Issued ID",
        mandatory: true,
        validityPeriodDays: 3650,
        acceptedIssuers: [],
        renewalBufferDays: 180,
      },
      {
        schemaId: "kyc_aml",
        schemaName: "BSA/AML Verification",
        mandatory: true,
        validityPeriodDays: 365,
        acceptedIssuers: [],
        renewalBufferDays: 30,
      },
      {
        schemaId: "ssn_verification",
        schemaName: "SSN Verification",
        mandatory: true,
        validityPeriodDays: 3650,
        acceptedIssuers: [],
        renewalBufferDays: 0,
      },
      {
        schemaId: "ofac_screen",
        schemaName: "OFAC Sanctions Screening",
        mandatory: true,
        validityPeriodDays: 30,
        acceptedIssuers: [],
        renewalBufferDays: 7,
      },
      {
        schemaId: "accredited_investor",
        schemaName: "Accredited Investor Status",
        mandatory: false,
        validityPeriodDays: 365,
        acceptedIssuers: [],
        renewalBufferDays: 30,
      },
    ],
    dataRetentionDays: 1825,
    consentRequirements: [
      {
        type: "implicit",
        purpose: "regulatory_compliance",
        retentionDays: 1825,
        withdrawalEnabled: false,
        granularity: "blanket",
      },
      {
        type: "explicit",
        purpose: "marketing",
        retentionDays: 365,
        withdrawalEnabled: true,
        granularity: "per_attribute",
      },
    ],
    reportingObligations: [
      {
        type: "SAR",
        frequency: "real_time",
        authority: "FinCEN",
        format: "BSA_XML",
        thresholdAmount: 5000,
        thresholdCurrency: "USD",
        description: "Suspicious Activity Report for transactions above $5,000",
      },
      {
        type: "CTR",
        frequency: "daily",
        authority: "FinCEN",
        format: "BSA_XML",
        thresholdAmount: 10000,
        thresholdCurrency: "USD",
        description:
          "Currency Transaction Report for cash transactions above $10,000",
      },
      {
        type: "FBAR",
        frequency: "annual",
        authority: "FinCEN",
        format: "BSA_XML",
        thresholdAmount: 10000,
        thresholdCurrency: "USD",
        description: "Foreign Bank Account Report",
      },
    ],
    scoringWeights: {
      credentialCoverage: 0.35,
      credentialFreshness: 0.25,
      consentCompliance: 0.1,
      reportingCompliance: 0.25,
      dataResidency: 0.05,
    },
    kycLevel: 3,
    specialConditions: [
      "State-by-state money transmitter licensing may apply",
      "OFAC screening must be near real-time",
      "Travel Rule applies to transfers above $3,000",
    ],
  },

  sg: {
    id: "sg",
    name: "Singapore",
    code: "SG",
    region: "apac",
    regulatoryAuthority: "Monetary Authority of Singapore",
    authorityAcronym: "MAS",
    authorityUrl: "https://www.mas.gov.sg",
    frameworks: ["PSA", "PS Act", "PDPA", "MAS Guidelines"],
    requiredCredentials: [
      {
        schemaId: "gov_id",
        schemaName: "Singapore NRIC or Passport",
        mandatory: true,
        validityPeriodDays: 3650,
        acceptedIssuers: [],
        renewalBufferDays: 180,
      },
      {
        schemaId: "kyc_aml",
        schemaName: "KYC/AML (MAS Compliant)",
        mandatory: true,
        validityPeriodDays: 365,
        acceptedIssuers: [],
        renewalBufferDays: 30,
      },
      {
        schemaId: "sanctions_screen",
        schemaName: "UN/MAS Sanctions Screening",
        mandatory: true,
        validityPeriodDays: 90,
        acceptedIssuers: [],
        renewalBufferDays: 14,
      },
    ],
    dataRetentionDays: 1825,
    consentRequirements: [
      {
        type: "explicit",
        purpose: "personal_data_collection",
        retentionDays: 1825,
        withdrawalEnabled: true,
        granularity: "per_attribute",
      },
      {
        type: "explicit",
        purpose: "cross_border_transfer",
        retentionDays: 1825,
        withdrawalEnabled: true,
        granularity: "per_credential",
      },
    ],
    reportingObligations: [
      {
        type: "STR",
        frequency: "real_time",
        authority: "STRO",
        format: "STRO_XML",
        thresholdAmount: 20000,
        thresholdCurrency: "SGD",
        description: "Suspicious Transaction Report to STRO",
      },
      {
        type: "CTR",
        frequency: "daily",
        authority: "MAS",
        format: "MAS_XML",
        thresholdAmount: 20000,
        thresholdCurrency: "SGD",
        description: "Cash Transaction Report",
      },
    ],
    scoringWeights: {
      credentialCoverage: 0.35,
      credentialFreshness: 0.2,
      consentCompliance: 0.2,
      reportingCompliance: 0.15,
      dataResidency: 0.1,
    },
    kycLevel: 3,
    specialConditions: [
      "Payment Services Act license required",
      "Technology risk management guidelines apply",
    ],
  },

  uk: {
    id: "uk",
    name: "United Kingdom",
    code: "GB",
    region: "eu",
    regulatoryAuthority: "Financial Conduct Authority",
    authorityAcronym: "FCA",
    authorityUrl: "https://www.fca.org.uk",
    frameworks: ["MLR 2017", "FCA SYSC", "UK GDPR", "Economic Crime Act"],
    requiredCredentials: [
      {
        schemaId: "gov_id",
        schemaName: "UK Passport or Driving Licence",
        mandatory: true,
        validityPeriodDays: 3650,
        acceptedIssuers: [],
        renewalBufferDays: 180,
      },
      {
        schemaId: "kyc_aml",
        schemaName: "KYC/AML (MLR Compliant)",
        mandatory: true,
        validityPeriodDays: 365,
        acceptedIssuers: [],
        renewalBufferDays: 30,
      },
      {
        schemaId: "residency",
        schemaName: "UK Proof of Address",
        mandatory: true,
        validityPeriodDays: 90,
        acceptedIssuers: [],
        renewalBufferDays: 14,
      },
      {
        schemaId: "sanctions_screen",
        schemaName: "OFSI Sanctions Screening",
        mandatory: true,
        validityPeriodDays: 90,
        acceptedIssuers: [],
        renewalBufferDays: 14,
      },
    ],
    dataRetentionDays: 1825,
    consentRequirements: [
      {
        type: "explicit",
        purpose: "personal_data_processing",
        retentionDays: 1825,
        withdrawalEnabled: true,
        granularity: "per_attribute",
      },
      {
        type: "explicit",
        purpose: "automated_decision_making",
        retentionDays: 365,
        withdrawalEnabled: true,
        granularity: "per_credential",
      },
    ],
    reportingObligations: [
      {
        type: "SAR",
        frequency: "real_time",
        authority: "NCA",
        format: "SAR_ONLINE",
        description: "Suspicious Activity Report to National Crime Agency",
      },
      {
        type: "FCA_REG_RETURN",
        frequency: "annual",
        authority: "FCA",
        format: "FCA_XML",
        description: "Annual regulatory return to FCA",
      },
    ],
    scoringWeights: {
      credentialCoverage: 0.3,
      credentialFreshness: 0.25,
      consentCompliance: 0.2,
      reportingCompliance: 0.15,
      dataResidency: 0.1,
    },
    kycLevel: 3,
    specialConditions: [
      "FCA cryptoasset registration required",
      "Enhanced due diligence for PEPs",
    ],
  },

  bh: {
    id: "bh",
    name: "Bahrain",
    code: "BH",
    region: "mena",
    regulatoryAuthority: "Central Bank of Bahrain",
    authorityAcronym: "CBB",
    authorityUrl: "https://www.cbb.gov.bh",
    frameworks: ["CBB Rulebook", "PDPL", "AML/CFT"],
    requiredCredentials: [
      {
        schemaId: "gov_id",
        schemaName: "Bahrain CPR or Passport",
        mandatory: true,
        validityPeriodDays: 1825,
        acceptedIssuers: [],
        renewalBufferDays: 90,
      },
      {
        schemaId: "kyc_aml",
        schemaName: "KYC/AML (CBB Compliant)",
        mandatory: true,
        validityPeriodDays: 365,
        acceptedIssuers: [],
        renewalBufferDays: 30,
      },
      {
        schemaId: "sanctions_screen",
        schemaName: "Sanctions Screening",
        mandatory: true,
        validityPeriodDays: 90,
        acceptedIssuers: [],
        renewalBufferDays: 14,
      },
    ],
    dataRetentionDays: 1825,
    consentRequirements: [
      {
        type: "explicit",
        purpose: "identity_verification",
        retentionDays: 1825,
        withdrawalEnabled: false,
        granularity: "per_credential",
      },
    ],
    reportingObligations: [
      {
        type: "STR",
        frequency: "real_time",
        authority: "AMLU",
        format: "goAML",
        description: "Suspicious Transaction Report",
      },
    ],
    scoringWeights: {
      credentialCoverage: 0.4,
      credentialFreshness: 0.2,
      consentCompliance: 0.15,
      reportingCompliance: 0.15,
      dataResidency: 0.1,
    },
    kycLevel: 2,
    specialConditions: [
      "CBB crypto-asset module licensing",
      "Regulatory sandbox available",
    ],
  },

  sa: {
    id: "sa",
    name: "Saudi Arabia",
    code: "SA",
    region: "mena",
    regulatoryAuthority: "Saudi Central Bank",
    authorityAcronym: "SAMA",
    authorityUrl: "https://www.sama.gov.sa",
    frameworks: ["AML Law", "PDPL", "CMA Regulations", "Open Banking"],
    requiredCredentials: [
      {
        schemaId: "gov_id",
        schemaName: "Saudi National ID or Iqama",
        mandatory: true,
        validityPeriodDays: 1825,
        acceptedIssuers: ["did:aethelred:issuer:sa_nic"],
        renewalBufferDays: 90,
      },
      {
        schemaId: "kyc_aml",
        schemaName: "KYC/AML (SAMA Compliant)",
        mandatory: true,
        validityPeriodDays: 365,
        acceptedIssuers: [],
        renewalBufferDays: 30,
      },
      {
        schemaId: "sanctions_screen",
        schemaName: "Sanctions Screening",
        mandatory: true,
        validityPeriodDays: 90,
        acceptedIssuers: [],
        renewalBufferDays: 14,
      },
      {
        schemaId: "absher_verification",
        schemaName: "Absher Identity Verification",
        mandatory: false,
        validityPeriodDays: 365,
        acceptedIssuers: ["did:aethelred:issuer:sa_absher"],
        renewalBufferDays: 30,
      },
    ],
    dataRetentionDays: 3650,
    consentRequirements: [
      {
        type: "explicit",
        purpose: "personal_data_processing",
        retentionDays: 3650,
        withdrawalEnabled: true,
        granularity: "per_credential",
      },
      {
        type: "explicit",
        purpose: "cross_border_transfer",
        retentionDays: 3650,
        withdrawalEnabled: false,
        granularity: "blanket",
      },
    ],
    reportingObligations: [
      {
        type: "STR",
        frequency: "real_time",
        authority: "SAFIU",
        format: "goAML",
        description: "Suspicious Transaction Report",
      },
      {
        type: "CTR",
        frequency: "daily",
        authority: "SAMA",
        format: "SAMA_XML",
        thresholdAmount: 60000,
        thresholdCurrency: "SAR",
        description: "Cash Transaction Report",
      },
    ],
    scoringWeights: {
      credentialCoverage: 0.4,
      credentialFreshness: 0.2,
      consentCompliance: 0.15,
      reportingCompliance: 0.15,
      dataResidency: 0.1,
    },
    kycLevel: 3,
    specialConditions: [
      "SAMA fintech license required",
      "Data must be stored within KSA",
    ],
  },

  hk: {
    id: "hk",
    name: "Hong Kong",
    code: "HK",
    region: "apac",
    regulatoryAuthority: "Securities and Futures Commission",
    authorityAcronym: "SFC",
    authorityUrl: "https://www.sfc.hk",
    frameworks: ["AMLO", "SFO", "PDPO", "VASP Regime"],
    requiredCredentials: [
      {
        schemaId: "gov_id",
        schemaName: "HKID or Passport",
        mandatory: true,
        validityPeriodDays: 3650,
        acceptedIssuers: [],
        renewalBufferDays: 180,
      },
      {
        schemaId: "kyc_aml",
        schemaName: "KYC/AML (AMLO Compliant)",
        mandatory: true,
        validityPeriodDays: 365,
        acceptedIssuers: [],
        renewalBufferDays: 30,
      },
      {
        schemaId: "sanctions_screen",
        schemaName: "UN/HK Sanctions Screening",
        mandatory: true,
        validityPeriodDays: 90,
        acceptedIssuers: [],
        renewalBufferDays: 14,
      },
      {
        schemaId: "professional_investor",
        schemaName: "Professional Investor Status",
        mandatory: false,
        validityPeriodDays: 365,
        acceptedIssuers: [],
        renewalBufferDays: 30,
      },
    ],
    dataRetentionDays: 2190,
    consentRequirements: [
      {
        type: "explicit",
        purpose: "personal_data_collection",
        retentionDays: 2190,
        withdrawalEnabled: true,
        granularity: "per_attribute",
      },
    ],
    reportingObligations: [
      {
        type: "STR",
        frequency: "real_time",
        authority: "JFIU",
        format: "JFIU_XML",
        description:
          "Suspicious Transaction Report to Joint Financial Intelligence Unit",
      },
      {
        type: "VASP_Report",
        frequency: "monthly",
        authority: "SFC",
        format: "SFC_XML",
        description: "VASP monthly transaction report",
      },
    ],
    scoringWeights: {
      credentialCoverage: 0.35,
      credentialFreshness: 0.2,
      consentCompliance: 0.15,
      reportingCompliance: 0.2,
      dataResidency: 0.1,
    },
    kycLevel: 3,
    specialConditions: [
      "SFC VASP license required for virtual asset trading platforms",
      "Professional investor classification for certain products",
    ],
  },

  jp: {
    id: "jp",
    name: "Japan",
    code: "JP",
    region: "apac",
    regulatoryAuthority: "Financial Services Agency",
    authorityAcronym: "FSA",
    authorityUrl: "https://www.fsa.go.jp",
    frameworks: ["PSA", "FIEA", "APPI", "JFSA Guidelines", "Travel Rule"],
    requiredCredentials: [
      {
        schemaId: "gov_id",
        schemaName: "My Number Card or Passport",
        mandatory: true,
        validityPeriodDays: 3650,
        acceptedIssuers: [],
        renewalBufferDays: 180,
      },
      {
        schemaId: "kyc_aml",
        schemaName: "KYC/AML (PSA Compliant)",
        mandatory: true,
        validityPeriodDays: 365,
        acceptedIssuers: [],
        renewalBufferDays: 30,
      },
      {
        schemaId: "residency",
        schemaName: "Japan Residency Proof",
        mandatory: true,
        validityPeriodDays: 365,
        acceptedIssuers: [],
        renewalBufferDays: 30,
      },
      {
        schemaId: "sanctions_screen",
        schemaName: "JAFIC Sanctions Screening",
        mandatory: true,
        validityPeriodDays: 90,
        acceptedIssuers: [],
        renewalBufferDays: 14,
      },
    ],
    dataRetentionDays: 2555,
    consentRequirements: [
      {
        type: "explicit",
        purpose: "personal_information_handling",
        retentionDays: 2555,
        withdrawalEnabled: true,
        granularity: "per_attribute",
      },
      {
        type: "explicit",
        purpose: "third_party_provision",
        retentionDays: 2555,
        withdrawalEnabled: true,
        granularity: "per_credential",
      },
    ],
    reportingObligations: [
      {
        type: "STR",
        frequency: "real_time",
        authority: "JAFIC",
        format: "JAFIC_XML",
        description: "Suspicious Transaction Report to JAFIC",
      },
      {
        type: "Travel_Rule",
        frequency: "real_time",
        authority: "FSA",
        format: "TRUST_XML",
        thresholdAmount: 100000,
        thresholdCurrency: "JPY",
        description: "Travel Rule reporting for transfers above 100,000 JPY",
      },
    ],
    scoringWeights: {
      credentialCoverage: 0.3,
      credentialFreshness: 0.25,
      consentCompliance: 0.2,
      reportingCompliance: 0.15,
      dataResidency: 0.1,
    },
    kycLevel: 3,
    specialConditions: [
      "JVCEA self-regulatory compliance required",
      "My Number handling requires special safeguards under APPI",
    ],
  },
};

// ============================================================================
// Cross-Border Compatibility Matrix
// ============================================================================

/**
 * Pairwise compatibility scores and restrictions for cross-border transfers.
 * Score 0-100: 100 = fully compatible, 0 = prohibited.
 */
export const CROSS_BORDER_MATRIX: Record<
  JurisdictionId,
  Partial<Record<JurisdictionId, CrossBorderCompatibility>>
> = {
  uae: {
    eu: {
      score: 65,
      restrictions: [
        "GDPR adequacy not established",
        "Enhanced due diligence required",
      ],
      bilateralAgreements: ["GCC-EU Dialogue"],
      additionalRequirements: ["EU-standard KYC required"],
    },
    us: {
      score: 70,
      restrictions: ["OFAC screening mandatory", "FinCEN travel rule applies"],
      bilateralAgreements: ["US-UAE Tax Treaty"],
      additionalRequirements: ["OFAC SDN list check"],
    },
    sg: {
      score: 80,
      restrictions: [],
      bilateralAgreements: ["UAE-Singapore CEPA"],
      additionalRequirements: [],
    },
    uk: {
      score: 75,
      restrictions: ["OFSI screening required"],
      bilateralAgreements: ["UK-UAE Sovereign Investment Partnership"],
      additionalRequirements: ["UK MLR compliance"],
    },
    bh: {
      score: 95,
      restrictions: [],
      bilateralAgreements: ["GCC Economic Agreement"],
      additionalRequirements: [],
    },
    sa: {
      score: 90,
      restrictions: [],
      bilateralAgreements: ["GCC Economic Agreement"],
      additionalRequirements: [],
    },
    hk: {
      score: 75,
      restrictions: [],
      bilateralAgreements: [],
      additionalRequirements: ["AMLO compliance"],
    },
    jp: {
      score: 70,
      restrictions: ["Travel Rule compliance required"],
      bilateralAgreements: [],
      additionalRequirements: ["JAFIC screening"],
    },
  },
  eu: {
    uae: {
      score: 65,
      restrictions: ["No GDPR adequacy decision for UAE", "SCCs required"],
      bilateralAgreements: ["GCC-EU Dialogue"],
      additionalRequirements: ["Standard Contractual Clauses"],
    },
    us: {
      score: 70,
      restrictions: [
        "EU-US Data Privacy Framework required",
        "Schrems II considerations",
      ],
      bilateralAgreements: ["EU-US Data Privacy Framework"],
      additionalRequirements: ["DPF certification check"],
    },
    sg: {
      score: 80,
      restrictions: [],
      bilateralAgreements: ["EU-Singapore FTA"],
      additionalRequirements: [],
    },
    uk: {
      score: 85,
      restrictions: [],
      bilateralAgreements: ["UK adequacy decision", "TCA"],
      additionalRequirements: [],
    },
    bh: {
      score: 55,
      restrictions: ["No adequacy decision", "SCCs required"],
      bilateralAgreements: [],
      additionalRequirements: ["Standard Contractual Clauses"],
    },
    sa: {
      score: 50,
      restrictions: ["No adequacy decision", "Enhanced due diligence"],
      bilateralAgreements: [],
      additionalRequirements: ["SCCs", "Transfer Impact Assessment"],
    },
    hk: {
      score: 65,
      restrictions: ["No adequacy decision"],
      bilateralAgreements: [],
      additionalRequirements: ["SCCs"],
    },
    jp: {
      score: 90,
      restrictions: [],
      bilateralAgreements: ["EU-Japan adequacy decision"],
      additionalRequirements: [],
    },
  },
  us: {
    uae: {
      score: 70,
      restrictions: ["OFAC compliance required"],
      bilateralAgreements: ["US-UAE Tax Treaty"],
      additionalRequirements: ["OFAC screening"],
    },
    eu: {
      score: 70,
      restrictions: ["EU-US DPF required for data transfers"],
      bilateralAgreements: ["EU-US Data Privacy Framework"],
      additionalRequirements: ["DPF certification"],
    },
    sg: {
      score: 80,
      restrictions: [],
      bilateralAgreements: ["US-Singapore FTA"],
      additionalRequirements: [],
    },
    uk: {
      score: 85,
      restrictions: [],
      bilateralAgreements: ["US-UK Data Access Agreement"],
      additionalRequirements: [],
    },
    bh: {
      score: 60,
      restrictions: ["Enhanced due diligence"],
      bilateralAgreements: [],
      additionalRequirements: ["OFAC screening"],
    },
    sa: {
      score: 55,
      restrictions: ["OFAC screening", "Enhanced monitoring"],
      bilateralAgreements: [],
      additionalRequirements: ["OFAC SDN check"],
    },
    hk: {
      score: 70,
      restrictions: ["OFAC Hong Kong considerations"],
      bilateralAgreements: [],
      additionalRequirements: ["OFAC screening"],
    },
    jp: {
      score: 85,
      restrictions: [],
      bilateralAgreements: ["US-Japan Digital Trade Agreement"],
      additionalRequirements: [],
    },
  },
  sg: {
    uae: {
      score: 80,
      restrictions: [],
      bilateralAgreements: ["UAE-Singapore CEPA"],
      additionalRequirements: [],
    },
    eu: {
      score: 80,
      restrictions: [],
      bilateralAgreements: ["EU-Singapore FTA"],
      additionalRequirements: [],
    },
    us: {
      score: 80,
      restrictions: [],
      bilateralAgreements: ["US-Singapore FTA"],
      additionalRequirements: [],
    },
    uk: {
      score: 80,
      restrictions: [],
      bilateralAgreements: ["UK-Singapore FTA"],
      additionalRequirements: [],
    },
    hk: {
      score: 85,
      restrictions: [],
      bilateralAgreements: ["ASEAN+"],
      additionalRequirements: [],
    },
    jp: {
      score: 85,
      restrictions: [],
      bilateralAgreements: ["RCEP", "CPTPP"],
      additionalRequirements: [],
    },
    bh: {
      score: 70,
      restrictions: [],
      bilateralAgreements: [],
      additionalRequirements: [],
    },
    sa: {
      score: 70,
      restrictions: [],
      bilateralAgreements: [],
      additionalRequirements: [],
    },
  },
  uk: {
    uae: {
      score: 75,
      restrictions: [],
      bilateralAgreements: ["UK-UAE Sovereign Investment Partnership"],
      additionalRequirements: ["OFSI screening"],
    },
    eu: {
      score: 85,
      restrictions: [],
      bilateralAgreements: ["UK adequacy decision", "TCA"],
      additionalRequirements: [],
    },
    us: {
      score: 85,
      restrictions: [],
      bilateralAgreements: ["US-UK Data Access Agreement"],
      additionalRequirements: [],
    },
    sg: {
      score: 80,
      restrictions: [],
      bilateralAgreements: ["UK-Singapore FTA"],
      additionalRequirements: [],
    },
    hk: {
      score: 70,
      restrictions: [],
      bilateralAgreements: [],
      additionalRequirements: [],
    },
    jp: {
      score: 80,
      restrictions: [],
      bilateralAgreements: ["UK-Japan CEPA"],
      additionalRequirements: [],
    },
    bh: {
      score: 65,
      restrictions: [],
      bilateralAgreements: [],
      additionalRequirements: [],
    },
    sa: {
      score: 60,
      restrictions: ["Enhanced due diligence"],
      bilateralAgreements: [],
      additionalRequirements: [],
    },
  },
  bh: {
    uae: {
      score: 95,
      restrictions: [],
      bilateralAgreements: ["GCC Economic Agreement"],
      additionalRequirements: [],
    },
    sa: {
      score: 90,
      restrictions: [],
      bilateralAgreements: ["GCC Economic Agreement"],
      additionalRequirements: [],
    },
    eu: {
      score: 55,
      restrictions: ["No adequacy decision"],
      bilateralAgreements: [],
      additionalRequirements: ["SCCs"],
    },
    us: {
      score: 60,
      restrictions: ["OFAC screening"],
      bilateralAgreements: [],
      additionalRequirements: [],
    },
    sg: {
      score: 70,
      restrictions: [],
      bilateralAgreements: [],
      additionalRequirements: [],
    },
    uk: {
      score: 65,
      restrictions: [],
      bilateralAgreements: [],
      additionalRequirements: [],
    },
    hk: {
      score: 65,
      restrictions: [],
      bilateralAgreements: [],
      additionalRequirements: [],
    },
    jp: {
      score: 60,
      restrictions: [],
      bilateralAgreements: [],
      additionalRequirements: [],
    },
  },
  sa: {
    uae: {
      score: 90,
      restrictions: [],
      bilateralAgreements: ["GCC Economic Agreement"],
      additionalRequirements: [],
    },
    bh: {
      score: 90,
      restrictions: [],
      bilateralAgreements: ["GCC Economic Agreement"],
      additionalRequirements: [],
    },
    eu: {
      score: 50,
      restrictions: ["No adequacy decision", "Data localization requirements"],
      bilateralAgreements: [],
      additionalRequirements: ["SCCs", "TIA"],
    },
    us: {
      score: 55,
      restrictions: ["OFAC considerations"],
      bilateralAgreements: [],
      additionalRequirements: ["OFAC screening"],
    },
    sg: {
      score: 70,
      restrictions: [],
      bilateralAgreements: [],
      additionalRequirements: [],
    },
    uk: {
      score: 60,
      restrictions: [],
      bilateralAgreements: [],
      additionalRequirements: [],
    },
    hk: {
      score: 60,
      restrictions: [],
      bilateralAgreements: [],
      additionalRequirements: [],
    },
    jp: {
      score: 55,
      restrictions: [],
      bilateralAgreements: [],
      additionalRequirements: [],
    },
  },
  hk: {
    uae: {
      score: 75,
      restrictions: [],
      bilateralAgreements: [],
      additionalRequirements: [],
    },
    eu: {
      score: 65,
      restrictions: ["No adequacy decision"],
      bilateralAgreements: [],
      additionalRequirements: ["SCCs"],
    },
    us: {
      score: 70,
      restrictions: ["OFAC considerations"],
      bilateralAgreements: [],
      additionalRequirements: [],
    },
    sg: {
      score: 85,
      restrictions: [],
      bilateralAgreements: ["ASEAN+"],
      additionalRequirements: [],
    },
    uk: {
      score: 70,
      restrictions: [],
      bilateralAgreements: [],
      additionalRequirements: [],
    },
    jp: {
      score: 80,
      restrictions: [],
      bilateralAgreements: ["RCEP"],
      additionalRequirements: [],
    },
    bh: {
      score: 65,
      restrictions: [],
      bilateralAgreements: [],
      additionalRequirements: [],
    },
    sa: {
      score: 60,
      restrictions: [],
      bilateralAgreements: [],
      additionalRequirements: [],
    },
  },
  jp: {
    uae: {
      score: 70,
      restrictions: [],
      bilateralAgreements: [],
      additionalRequirements: [],
    },
    eu: {
      score: 90,
      restrictions: [],
      bilateralAgreements: ["EU-Japan adequacy decision"],
      additionalRequirements: [],
    },
    us: {
      score: 85,
      restrictions: [],
      bilateralAgreements: ["US-Japan Digital Trade Agreement"],
      additionalRequirements: [],
    },
    sg: {
      score: 85,
      restrictions: [],
      bilateralAgreements: ["RCEP", "CPTPP"],
      additionalRequirements: [],
    },
    uk: {
      score: 80,
      restrictions: [],
      bilateralAgreements: ["UK-Japan CEPA"],
      additionalRequirements: [],
    },
    hk: {
      score: 80,
      restrictions: [],
      bilateralAgreements: ["RCEP"],
      additionalRequirements: [],
    },
    bh: {
      score: 60,
      restrictions: [],
      bilateralAgreements: [],
      additionalRequirements: [],
    },
    sa: {
      score: 55,
      restrictions: [],
      bilateralAgreements: [],
      additionalRequirements: [],
    },
  },
};

// ============================================================================
// Utility Functions
// ============================================================================

/** Get all active jurisdiction IDs */
export function getAllJurisdictionIds(): JurisdictionId[] {
  return Object.keys(JURISDICTIONS) as JurisdictionId[];
}

/** Get jurisdictions by region */
export function getJurisdictionsByRegion(
  region: JurisdictionDefinition["region"],
): JurisdictionDefinition[] {
  return Object.values(JURISDICTIONS).filter((j) => j.region === region);
}

/** Get the cross-border compatibility between two jurisdictions */
export function getCrossBorderCompatibility(
  from: JurisdictionId,
  to: JurisdictionId,
): CrossBorderCompatibility | null {
  return CROSS_BORDER_MATRIX[from]?.[to] ?? null;
}

/** Get all jurisdictions that require a specific credential schema */
export function getJurisdictionsRequiringSchema(
  schemaId: string,
  mandatoryOnly = false,
): JurisdictionDefinition[] {
  return Object.values(JURISDICTIONS).filter((j) =>
    j.requiredCredentials.some(
      (r) => r.schemaId === schemaId && (!mandatoryOnly || r.mandatory),
    ),
  );
}

/** Get the strictest data retention period across a set of jurisdictions */
export function getStrictestRetentionDays(
  jurisdictionIds: JurisdictionId[],
): number {
  return Math.max(
    ...jurisdictionIds.map((id) => JURISDICTIONS[id]?.dataRetentionDays ?? 0),
  );
}

/** Get the highest KYC level required across a set of jurisdictions */
export function getHighestKYCLevel(jurisdictionIds: JurisdictionId[]): number {
  return Math.max(
    ...jurisdictionIds.map((id) => JURISDICTIONS[id]?.kycLevel ?? 0),
  );
}
