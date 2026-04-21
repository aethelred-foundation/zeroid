import type {
  EnterpriseApprovalClass,
  EnterpriseGovernanceFamily,
  EnterpriseRole,
  OrganizationGovernanceSettings,
} from './organization-service';

export type GovernedPolicyFamily = 'compliance' | 'reporting' | 'privacy' | 'screening';
export type GovernedApprovalMode = 'single_admin' | 'separation_of_duties' | 'dual_control';
type EnterprisePlanTier = 'starter' | 'growth' | 'enterprise';

export interface PolicyGovernanceInput {
  organizationPlan: string;
  organizationJurisdictions: string[];
  organizationGovernanceSettings?: OrganizationGovernanceSettings;
  policyName: string;
  family: GovernedPolicyFamily;
  approvalMode: GovernedApprovalMode;
  requiredApprovals?: number;
  requiredApprovalRoles?: EnterpriseRole[];
  requiredApprovalClasses?: EnterpriseApprovalClass[];
  requiredApprovalJurisdictions?: string[];
}

export interface PolicyGovernanceProfile {
  approvalMode: GovernedApprovalMode;
  requiredApprovals: number;
  requiredApprovalRoles: EnterpriseRole[];
  requiredApprovalClasses: EnterpriseApprovalClass[];
  requiredApprovalJurisdictions: string[];
  governancePackId: string;
  governancePackVersion: string;
  governancePackLabel: string;
  governanceProfileId: string;
  governanceProfileLabel: string;
  governanceRationale: string[];
}

interface GovernancePackDefinition {
  id: string;
  version: string;
  label: string;
  minimumPlan: EnterprisePlanTier;
  supportsDefaultSelection: boolean;
  supportedFamilies?: GovernedPolicyFamily[];
  requiresMultiJurisdiction?: boolean;
  requiresSovereignJurisdiction?: boolean;
}

export interface GovernancePackDescriptor extends GovernancePackDefinition {
  profileHints: string[];
}

export interface GovernancePackCompatibilityIssue {
  scope: 'defaultPack' | 'familyPack';
  packId: string;
  reason: string;
  family?: GovernedPolicyFamily;
}

export interface PolicyDefinitionCompatibilityIssue {
  packId: string;
  reason: string;
  family?: GovernedPolicyFamily;
}

const POLICY_DEFINITION_COMPATIBILITY_RULES: Partial<Record<string, {
  families?: GovernedPolicyFamily[];
  requiredKeys: string[];
  message: string;
}>> = {
  'enterprise-privacy': {
    families: ['privacy'],
    requiredKeys: ['privacyRights', 'retentionPolicy', 'lawfulBasis', 'dataCategories', 'dsarWorkflow', 'reviewCadence'],
    message: 'Enterprise privacy governance requires definition fields like privacyRights, retentionPolicy, lawfulBasis, or dsarWorkflow.',
  },
  'enterprise-screening': {
    families: ['screening'],
    requiredKeys: ['screeningRules', 'watchlists', 'escalationPolicy', 'matchThreshold', 'falsePositiveWorkflow'],
    message: 'Enterprise screening governance requires definition fields like screeningRules, watchlists, escalationPolicy, or matchThreshold.',
  },
  'enterprise-reporting': {
    families: ['reporting'],
    requiredKeys: ['reportType', 'reportingChannels', 'filingRules', 'reportSchema', 'submissionCadence'],
    message: 'Enterprise reporting governance requires definition fields like reportType, reportSchema, filingRules, or submissionCadence.',
  },
  'cross-border-regulated': {
    requiredKeys: ['transferRules', 'transferMechanisms', 'dataLocalization', 'jurisdictionMatrix', 'recipientControls'],
    message: 'Cross-border governance requires definition fields like transferRules, transferMechanisms, dataLocalization, or jurisdictionMatrix.',
  },
  'sovereign-core': {
    requiredKeys: ['sovereignBoundaries', 'nationalHosting', 'issuerTrustRequirements', 'sovereignApprovalChain', 'regulatorAuthority'],
    message: 'Sovereign governance requires definition fields like sovereignBoundaries, nationalHosting, issuerTrustRequirements, or regulatorAuthority.',
  },
};

const GOVERNANCE_PACKS = {
  baseline: {
    id: 'baseline-core',
    version: '2026.04',
    label: 'Baseline Core Governance Pack',
    minimumPlan: 'starter',
    supportsDefaultSelection: true,
  },
  enterprisePrivacy: {
    id: 'enterprise-privacy',
    version: '2026.04',
    label: 'Enterprise Privacy Governance Pack',
    minimumPlan: 'growth',
    supportsDefaultSelection: false,
    supportedFamilies: ['privacy'],
  },
  enterpriseScreening: {
    id: 'enterprise-screening',
    version: '2026.04',
    label: 'Enterprise Screening Governance Pack',
    minimumPlan: 'growth',
    supportsDefaultSelection: false,
    supportedFamilies: ['screening'],
  },
  enterpriseReporting: {
    id: 'enterprise-reporting',
    version: '2026.04',
    label: 'Enterprise Reporting Governance Pack',
    minimumPlan: 'growth',
    supportsDefaultSelection: false,
    supportedFamilies: ['reporting'],
  },
  crossBorder: {
    id: 'cross-border-regulated',
    version: '2026.04',
    label: 'Cross-Border Regulated Governance Pack',
    minimumPlan: 'growth',
    supportsDefaultSelection: true,
    requiresMultiJurisdiction: true,
  },
  sovereign: {
    id: 'sovereign-core',
    version: '2026.04',
    label: 'Sovereign Core Governance Pack',
    minimumPlan: 'enterprise',
    supportsDefaultSelection: true,
    requiresSovereignJurisdiction: true,
  },
} as const satisfies Record<string, GovernancePackDefinition>;

const ENTERPRISE_ROLES = [
  'viewer',
  'operator',
  'admin',
  'compliance_officer',
  'auditor',
] as const satisfies readonly EnterpriseRole[];

const ENTERPRISE_APPROVAL_CLASSES = [
  'admin',
  'auditor',
  'compliance',
  'legal',
  'operator',
  'privacy',
  'risk',
  'sovereign_operator',
] as const satisfies readonly EnterpriseApprovalClass[];

export class PolicyGovernanceService {
  listGovernancePacks(): GovernancePackDescriptor[] {
    return [
      {
        ...GOVERNANCE_PACKS.baseline,
        profileHints: ['default'],
      },
      {
        ...GOVERNANCE_PACKS.enterprisePrivacy,
        profileHints: ['privacy', 'regulated-privacy', 'enterprise'],
      },
      {
        ...GOVERNANCE_PACKS.enterpriseScreening,
        profileHints: ['screening', 'enterprise'],
      },
      {
        ...GOVERNANCE_PACKS.enterpriseReporting,
        profileHints: ['reporting', 'enterprise'],
      },
      {
        ...GOVERNANCE_PACKS.crossBorder,
        profileHints: ['cross-border', 'cross-border-compliance', 'growth', 'enterprise'],
      },
      {
        ...GOVERNANCE_PACKS.sovereign,
        profileHints: ['sovereign'],
      },
    ];
  }

  validateGovernanceSettings(input: {
    organizationPlan: string;
    organizationJurisdictions: string[];
    settings: OrganizationGovernanceSettings;
  }): GovernancePackCompatibilityIssue[] {
    const plan = this.normalizePlan(input.organizationPlan);
    const jurisdictions = this.normalizeJurisdictions(input.organizationJurisdictions);
    const issues: GovernancePackCompatibilityIssue[] = [];

    const validateSelection = (
      selection: { packId: string; version?: string } | undefined,
      scope: 'defaultPack' | 'familyPack',
      family?: GovernedPolicyFamily,
    ) => {
      if (!selection?.packId) {
        return;
      }

      const pack = Object.values(GOVERNANCE_PACKS).find((entry) => entry.id === selection.packId);
      if (!pack) {
        return;
      }

      if (scope === 'defaultPack' && !pack.supportsDefaultSelection) {
        issues.push({
          scope,
          packId: pack.id,
          reason: `${pack.label} can only be pinned at the family level, not as an organization default.`,
        });
      }

      if (family && pack.supportedFamilies && !pack.supportedFamilies.includes(family)) {
        issues.push({
          scope,
          packId: pack.id,
          family,
          reason: `${pack.label} is not compatible with the ${family} governance family.`,
        });
      }

      if (this.planRank(plan) < this.planRank(pack.minimumPlan)) {
        issues.push({
          scope,
          packId: pack.id,
          ...(family ? { family } : {}),
          reason: `${pack.label} requires at least the ${pack.minimumPlan} plan.`,
        });
      }

      if (pack.requiresMultiJurisdiction && jurisdictions.length < 2) {
        issues.push({
          scope,
          packId: pack.id,
          ...(family ? { family } : {}),
          reason: `${pack.label} requires at least two organization jurisdictions.`,
        });
      }

      if (pack.requiresSovereignJurisdiction && !this.hasSovereignJurisdiction(jurisdictions)) {
        issues.push({
          scope,
          packId: pack.id,
          ...(family ? { family } : {}),
          reason: `${pack.label} requires a sovereign-scoped jurisdiction like GOV, STATE, or NATIONAL.`,
        });
      }
    };

    validateSelection(input.settings.defaultPack, 'defaultPack');
    for (const [family, selection] of Object.entries(input.settings.familyPacks ?? {})) {
      validateSelection(selection, 'familyPack', family as GovernedPolicyFamily);
    }

    return issues;
  }

  validatePolicyDefinitionCompatibility(
    family: GovernedPolicyFamily,
    governancePackId: string | undefined,
    definition: Record<string, unknown>,
  ): PolicyDefinitionCompatibilityIssue | null {
    if (!governancePackId) {
      return null;
    }

    const rule = POLICY_DEFINITION_COMPATIBILITY_RULES[governancePackId];
    if (!rule) {
      return null;
    }

    if (rule.families && !rule.families.includes(family)) {
      return {
        packId: governancePackId,
        family,
        reason: `${governancePackId} is not compatible with ${family} policies.`,
      };
    }

    const definitionKeys = new Set(Object.keys(definition ?? {}));
    const hasAnyKey = rule.requiredKeys.some((key) => definitionKeys.has(key));
    if (hasAnyKey) {
      return null;
    }

    return {
      packId: governancePackId,
      family,
      reason: rule.message,
    };
  }

  applyGovernanceBaseline(input: PolicyGovernanceInput): PolicyGovernanceProfile {
    const plan = String(input.organizationPlan ?? 'starter').toLowerCase();
    const policyName = String(input.policyName ?? '').toLowerCase();
    const organizationJurisdictions = this.normalizeJurisdictions(input.organizationJurisdictions);
    const requiredApprovalRoles = new Set(this.normalizeRoles(input.requiredApprovalRoles));
    const requiredApprovalClasses = new Set(this.normalizeClasses(input.requiredApprovalClasses));
    const requiredApprovalJurisdictions = new Set(
      this.normalizeJurisdictions(input.requiredApprovalJurisdictions),
    );
    const rationale = new Set<string>();
    const profileSegments = new Set<string>();

    let approvalMode = this.normalizeApprovalMode(input.approvalMode);
    let requiredApprovals = this.normalizeRequiredApprovals(input.requiredApprovals);

    const isEnterprise = plan === 'enterprise';
    const isGrowth = plan === 'growth';
    const isCrossBorder = policyName.includes('cross_border') || policyName.includes('crossborder');
    const isBreach = policyName.includes('breach');
    const isDataSubject = policyName.includes('data_subject') || policyName.includes('privacy_impact');
    const requiresSovereignLane = organizationJurisdictions.some((jurisdiction) =>
      /(gov|state|national|sovereign)/i.test(jurisdiction),
    ) || policyName.includes('sovereign');
    const isHighRisk =
      input.family === 'privacy'
      || input.family === 'screening'
      || input.family === 'reporting'
      || isCrossBorder
      || isBreach;

    const ensureRole = (role: EnterpriseRole, reason: string) => {
      if (!requiredApprovalRoles.has(role)) {
        requiredApprovalRoles.add(role);
        rationale.add(reason);
      }
    };

    const ensureClass = (approvalClass: EnterpriseApprovalClass, reason: string) => {
      if (!requiredApprovalClasses.has(approvalClass)) {
        requiredApprovalClasses.add(approvalClass);
        rationale.add(reason);
      }
    };

    const ensureJurisdictions = (jurisdictions: string[], reason: string) => {
      let added = false;
      for (const jurisdiction of this.normalizeJurisdictions(jurisdictions)) {
        if (!requiredApprovalJurisdictions.has(jurisdiction)) {
          requiredApprovalJurisdictions.add(jurisdiction);
          added = true;
        }
      }
      if (added) {
        rationale.add(reason);
      }
    };

    const ensureApprovalMode = (nextMode: GovernedApprovalMode, reason: string) => {
      if (nextMode === 'dual_control') {
        if (approvalMode !== 'dual_control') {
          approvalMode = 'dual_control';
          rationale.add(reason);
        }
        return;
      }
      if (nextMode === 'separation_of_duties' && approvalMode === 'single_admin') {
        approvalMode = 'separation_of_duties';
        rationale.add(reason);
      }
    };

    const ensureRequiredApprovals = (count: number, reason: string) => {
      if (requiredApprovals < count) {
        requiredApprovals = count;
        rationale.add(reason);
      }
    };

    if (input.family === 'privacy') {
      profileSegments.add('privacy');
      ensureClass('privacy', 'Privacy policies require an explicit privacy approval lane.');
    }

    if (input.family === 'screening') {
      profileSegments.add('screening');
      ensureClass('risk', 'Screening policies require a risk approval lane.');
      ensureClass('compliance', 'Screening policies require a compliance approval lane.');
    }

    if (input.family === 'reporting') {
      profileSegments.add('reporting');
      ensureClass('compliance', 'Reporting policies require a compliance approval lane.');
      ensureClass('risk', 'Reporting policies require a risk approval lane.');
    }

    if (input.family === 'compliance' && isCrossBorder) {
      profileSegments.add('cross-border-compliance');
      ensureClass('risk', 'Cross-border compliance policies require a risk approval lane.');
      ensureClass('legal', 'Cross-border compliance policies require a legal approval lane.');
      ensureClass('privacy', 'Cross-border compliance policies require a privacy approval lane.');
    }

    if (isCrossBorder) {
      profileSegments.add('cross-border');
      ensureApprovalMode(
        isEnterprise ? 'dual_control' : 'separation_of_duties',
        'Cross-border policies require elevated approval governance.',
      );
      ensureRequiredApprovals(
        isEnterprise ? 2 : 1,
        'Cross-border policies require stronger approval quorum.',
      );
      if (requiredApprovalJurisdictions.size === 0 && organizationJurisdictions.length >= 2) {
        ensureJurisdictions(
          organizationJurisdictions.slice(0, 2),
          'Cross-border policies bind approval lanes to the leading organization jurisdictions.',
        );
      }
    }

    if (isBreach || isDataSubject) {
      profileSegments.add('regulated-privacy');
      ensureClass('legal', 'Regulated privacy workflows require a legal approval lane.');
      ensureClass('privacy', 'Regulated privacy workflows require a privacy approval lane.');
    }

    if (isEnterprise && isHighRisk) {
      profileSegments.add('enterprise');
      ensureApprovalMode(
        'dual_control',
        'Enterprise high-risk policies require dual-control approval.',
      );
      ensureRequiredApprovals(
        2,
        'Enterprise high-risk policies require at least two approvers.',
      );

      switch (input.family) {
        case 'privacy':
          ensureRole('admin', 'Enterprise privacy policies require an admin approval lane.');
          ensureRole('auditor', 'Enterprise privacy policies require an auditor approval lane.');
          ensureClass('legal', 'Enterprise privacy policies require a legal approval lane.');
          break;
        case 'screening':
          ensureRole(
            'compliance_officer',
            'Enterprise screening policies require a compliance approval lane.',
          );
          ensureRole('auditor', 'Enterprise screening policies require an auditor approval lane.');
          break;
        case 'reporting':
          ensureRole('admin', 'Enterprise reporting policies require an admin approval lane.');
          ensureRole('auditor', 'Enterprise reporting policies require an auditor approval lane.');
          break;
        case 'compliance':
          if (isCrossBorder) {
            ensureRole('admin', 'Cross-border compliance policies require an admin approval lane.');
            ensureRole(
              'compliance_officer',
              'Cross-border compliance policies require a compliance approval lane.',
            );
          }
          break;
      }
    } else if (isGrowth && (input.family === 'privacy' || isCrossBorder || isBreach)) {
      profileSegments.add('growth');
      ensureApprovalMode(
        isCrossBorder || isBreach ? 'dual_control' : 'separation_of_duties',
        'Growth-tier regulated policies require separation of duties.',
      );

      if (isCrossBorder || isBreach) {
        ensureRequiredApprovals(
          2,
          'Growth-tier cross-border and breach policies require at least two approvers.',
        );
        ensureRole('admin', 'Growth-tier regulated policies require an admin approval lane.');
        ensureRole(
          'compliance_officer',
          'Growth-tier regulated policies require a compliance approval lane.',
        );
      } else {
        ensureRole('admin', 'Growth-tier privacy policies require an admin approval lane.');
      }
    }

    if (requiresSovereignLane) {
      profileSegments.add('sovereign');
      ensureClass(
        'sovereign_operator',
        'Sovereign-scoped policies require a sovereign operator approval lane.',
      );
      ensureApprovalMode(
        approvalMode === 'single_admin' ? 'separation_of_duties' : approvalMode,
        'Sovereign-scoped policies require elevated governance lanes.',
      );
    }

    if (approvalMode === 'dual_control') {
      ensureRequiredApprovals(
        2,
        'Dual-control approval mode requires at least two approvers.',
      );
    }

    const governancePack = this.resolveGovernancePack(
      input.family,
      input.organizationGovernanceSettings,
      {
      family: input.family,
      isEnterprise,
      isCrossBorder,
      isBreach,
      requiresSovereignLane,
      },
      rationale,
    );

    const governanceProfileId =
      profileSegments.size > 0 ? [...profileSegments].join('.') : 'default';
    const governanceProfileLabel =
      profileSegments.size > 0
        ? [...profileSegments]
            .map((segment) => segment.replace(/[-.]/g, ' '))
            .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
            .join(' / ')
        : 'Default governance';

    return {
      approvalMode,
      requiredApprovals,
      requiredApprovalRoles: [...requiredApprovalRoles],
      requiredApprovalClasses: [...requiredApprovalClasses],
      requiredApprovalJurisdictions: [...requiredApprovalJurisdictions],
      governancePackId: governancePack.id,
      governancePackVersion: governancePack.version,
      governancePackLabel: governancePack.label,
      governanceProfileId,
      governanceProfileLabel,
      governanceRationale: [...rationale],
    };
  }

  private resolveGovernancePack(
    family: GovernedPolicyFamily,
    governanceSettings: OrganizationGovernanceSettings | undefined,
    input: {
      family: GovernedPolicyFamily;
      isEnterprise: boolean;
      isCrossBorder: boolean;
      isBreach: boolean;
      requiresSovereignLane: boolean;
    },
    rationale: Set<string>,
  ): GovernancePackDefinition {
    const requestedPack = this.resolveRequestedPack(family, governanceSettings, rationale);
    if (requestedPack) {
      return requestedPack;
    }

    if (input.requiresSovereignLane) {
      return GOVERNANCE_PACKS.sovereign;
    }
    if (input.isCrossBorder || (input.family === 'compliance' && input.isBreach)) {
      return GOVERNANCE_PACKS.crossBorder;
    }
    if (input.isEnterprise && input.family === 'privacy') {
      return GOVERNANCE_PACKS.enterprisePrivacy;
    }
    if (input.isEnterprise && input.family === 'screening') {
      return GOVERNANCE_PACKS.enterpriseScreening;
    }
    if (input.isEnterprise && input.family === 'reporting') {
      return GOVERNANCE_PACKS.enterpriseReporting;
    }
    return GOVERNANCE_PACKS.baseline;
  }

  private resolveRequestedPack(
    family: EnterpriseGovernanceFamily,
    governanceSettings: OrganizationGovernanceSettings | undefined,
    rationale: Set<string>,
  ): GovernancePackDefinition | null {
    const requested = governanceSettings?.familyPacks?.[family] ?? governanceSettings?.defaultPack;
    if (!requested?.packId) {
      return null;
    }

    const matchedPack = Object.values(GOVERNANCE_PACKS).find((pack) => pack.id === requested.packId);
    if (!matchedPack) {
      rationale.add(`Requested governance pack ${requested.packId} is not available; using platform defaults.`);
      return null;
    }

    if (requested.version && requested.version !== matchedPack.version) {
      rationale.add(
        `Requested governance pack ${requested.packId}@${requested.version} is unavailable; active pack version ${matchedPack.version} was applied.`,
      );
      return matchedPack;
    }

    rationale.add(`Tenant governance pack ${matchedPack.id}@${matchedPack.version} was selected.`);
    return matchedPack;
  }

  private normalizeApprovalMode(value: unknown): GovernedApprovalMode {
    const normalized = String(value ?? 'single_admin').toLowerCase();
    if (
      normalized === 'single_admin'
      || normalized === 'separation_of_duties'
      || normalized === 'dual_control'
    ) {
      return normalized;
    }
    return 'single_admin';
  }

  private normalizePlan(value: unknown): EnterprisePlanTier {
    const normalized = String(value ?? 'starter').toLowerCase();
    if (normalized === 'growth' || normalized === 'enterprise') {
      return normalized;
    }
    return 'starter';
  }

  private planRank(plan: EnterprisePlanTier): number {
    switch (plan) {
      case 'enterprise':
        return 3;
      case 'growth':
        return 2;
      default:
        return 1;
    }
  }

  private hasSovereignJurisdiction(jurisdictions: string[]): boolean {
    return jurisdictions.some((jurisdiction) => /(gov|state|national|sovereign)/i.test(jurisdiction));
  }

  private normalizeRequiredApprovals(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 1;
    }
    return Math.max(1, Math.trunc(value));
  }

  private normalizeRoles(value: unknown): EnterpriseRole[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return [...new Set(
      value
        .map((entry) => String(entry))
        .filter((entry): entry is EnterpriseRole =>
          ENTERPRISE_ROLES.includes(entry as EnterpriseRole),
        ),
    )];
  }

  private normalizeClasses(value: unknown): EnterpriseApprovalClass[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return [...new Set(
      value
        .map((entry) => String(entry))
        .filter((entry): entry is EnterpriseApprovalClass =>
          ENTERPRISE_APPROVAL_CLASSES.includes(entry as EnterpriseApprovalClass),
        ),
    )];
  }

  private normalizeJurisdictions(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return [...new Set(
      value
        .map((entry) => String(entry).trim())
        .filter((entry) => entry.length > 0),
    )];
  }
}

export const policyGovernanceService = new PolicyGovernanceService();
