import { policyGovernanceService } from '../src/services/enterprise/policy-governance-service';

describe('PolicyGovernanceService', () => {
  it('applies enterprise privacy dual-control governance baselines', () => {
    const governance = policyGovernanceService.applyGovernanceBaseline({
      organizationPlan: 'enterprise',
      organizationJurisdictions: ['EU-GDPR'],
      policyName: 'data_subject_access',
      family: 'privacy',
      approvalMode: 'single_admin',
    });

    expect(governance.approvalMode).toBe('dual_control');
    expect(governance.requiredApprovals).toBe(2);
    expect(governance.requiredApprovalRoles).toEqual(expect.arrayContaining(['admin', 'auditor']));
    expect(governance.requiredApprovalClasses).toEqual(
      expect.arrayContaining(['privacy', 'legal']),
    );
    expect(governance.governanceProfileId).toContain('privacy');
  });

  it('binds growth cross-border governance to multiple jurisdictions and regulated lanes', () => {
    const governance = policyGovernanceService.applyGovernanceBaseline({
      organizationPlan: 'growth',
      organizationJurisdictions: ['EU-GDPR', 'AE-ADGM', 'SG-PDPA'],
      policyName: 'jurisdiction_cross_border',
      family: 'compliance',
      approvalMode: 'single_admin',
    });

    expect(governance.approvalMode).toBe('dual_control');
    expect(governance.requiredApprovals).toBe(2);
    expect(governance.requiredApprovalRoles).toEqual(
      expect.arrayContaining(['admin', 'compliance_officer']),
    );
    expect(governance.requiredApprovalClasses).toEqual(
      expect.arrayContaining(['risk', 'legal', 'privacy']),
    );
    expect(governance.requiredApprovalJurisdictions).toEqual(['EU-GDPR', 'AE-ADGM']);
  });

  it('preserves stronger caller-supplied governance while adding required sovereign lanes', () => {
    const governance = policyGovernanceService.applyGovernanceBaseline({
      organizationPlan: 'enterprise',
      organizationJurisdictions: ['AE-GOV', 'EU-GDPR'],
      policyName: 'sovereign_reporting',
      family: 'reporting',
      approvalMode: 'dual_control',
      requiredApprovals: 3,
      requiredApprovalRoles: ['admin', 'auditor', 'compliance_officer'],
      requiredApprovalClasses: ['risk'],
      requiredApprovalJurisdictions: ['AE-GOV', 'EU-GDPR'],
    });

    expect(governance.approvalMode).toBe('dual_control');
    expect(governance.requiredApprovals).toBe(3);
    expect(governance.requiredApprovalRoles).toEqual(
      expect.arrayContaining(['admin', 'auditor', 'compliance_officer']),
    );
    expect(governance.requiredApprovalClasses).toEqual(
      expect.arrayContaining(['risk', 'compliance', 'sovereign_operator']),
    );
    expect(governance.requiredApprovalJurisdictions).toEqual(['AE-GOV', 'EU-GDPR']);
  });
});
