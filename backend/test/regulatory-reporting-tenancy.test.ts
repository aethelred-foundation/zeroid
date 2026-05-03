import {
  RegulatoryReportingService,
  SARRequest,
} from '../src/services/compliance/regulatory-reporting';

function sarRequest(entityId: string): SARRequest {
  return {
    reportType: 'SAR',
    filingInstitution: {
      name: 'ZeroID Bank',
      registrationNumber: 'REG-123',
      jurisdiction: 'US',
      contactName: 'Compliance Officer',
      contactEmail: 'compliance@example.com',
      contactPhone: '+15555550123',
    },
    subject: {
      entityId,
      entityType: 'individual',
      name: 'Test Subject',
      identifiers: [{ type: 'customer_id', value: entityId }],
    },
    suspiciousActivity: {
      description:
        'Suspicious activity narrative with enough detail for regulatory filing review.',
      activityType: 'identity_fraud',
      dateRange: {
        start: '2026-04-01T00:00:00.000Z',
        end: '2026-04-28T00:00:00.000Z',
      },
      transactionIds: [],
      relatedEntities: [],
    },
    priority: 'high',
  };
}

describe('RegulatoryReportingService tenant scoping', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('isolates report reads, dashboards, and mutations by organization', async () => {
    const service = new RegulatoryReportingService();
    const orgAReport = await service.generateSAR(sarRequest('entity-a'), 'org-a');
    await service.generateSAR(sarRequest('entity-b'), 'org-b');

    expect(service.getReport(orgAReport.reportId, 'org-a')?.reportId).toBe(
      orgAReport.reportId,
    );
    expect(service.getReport(orgAReport.reportId, 'org-b')).toBeNull();
    expect(service.listReports({ organizationId: 'org-a' })).toHaveLength(1);
    expect(service.listReports({ organizationId: 'org-b' })).toHaveLength(1);
    expect(service.getDashboardData('org-a').totalReports).toBe(1);
    expect(service.getDashboardData('org-b').totalReports).toBe(1);

    await expect(
      service.submitReport(orgAReport.reportId, 'org-b'),
    ).rejects.toMatchObject({
      code: 'REPORT_NOT_FOUND',
      statusCode: 404,
    });

    const submission = await service.submitReport(orgAReport.reportId, 'org-a');
    expect(submission.filingReference).toMatch(/^SAR-/);
  });

  it('fails closed for production submissions without an authority connector', async () => {
    process.env = { ...originalEnv, NODE_ENV: 'production' };
    const service = new RegulatoryReportingService();
    const report = await service.generateSAR(sarRequest('entity-prod'), 'org-a');

    await expect(
      service.submitReport(report.reportId, 'org-a'),
    ).rejects.toMatchObject({
      code: 'REPORT_SUBMISSION_CONNECTOR_REQUIRED',
      statusCode: 503,
    });

    expect(service.getReport(report.reportId, 'org-a')?.status).toBe('draft');
  });
});
