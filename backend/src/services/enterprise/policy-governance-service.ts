import type { EnterpriseApprovalClass, EnterpriseRole } from './organization-service';

export type GovernedPolicyFamily = 'compliance' | 'reporting' | 'privacy' | 'screening';
export type GovernedApprovalMode = 'single_admin' | 'separation_of_duties' | 'dual_control';

export interface PolicyGovernanceInput {
  organizationPlan: string;
  organizationJurisdictions: string[];
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
  governanceProfileId: string;
  governanceProfileLabel: string;
  governanceRationale: string[];
}

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
      governanceProfileId,
      governanceProfileLabel,
      governanceRationale: [...rationale],
    };
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
