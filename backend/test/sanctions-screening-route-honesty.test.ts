import fs from 'fs';
import path from 'path';

const aiRouteSource = fs.readFileSync(
  path.join(__dirname, '../src/routes/ai/compliance.ts'),
  'utf8',
);
const enterpriseRouteSource = fs.readFileSync(
  path.join(__dirname, '../src/routes/enterprise/compliance.ts'),
  'utf8',
);

function routeSection(
  source: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Unable to locate route section: ${startMarker}`);
  }
  return source.slice(start, end);
}

function expectRetiredEnterpriseScreeningRoute(section: string): void {
  expect(section).toContain('requireEnterpriseContext(');
  expect(section).toContain('requireReceiptContext(req, res)');
  expect(section).toContain('sendSanctionsScreeningUnavailable(res)');
  expect(section.indexOf('requireEnterpriseContext(')).toBeLessThan(
    section.indexOf('sendSanctionsScreeningUnavailable(res)'),
  );
  expect(section).not.toContain('sanctionsScreeningService.');
  expect(section).not.toContain('createPolicyAnchoredReceipt(');
  expect(section).not.toContain('res.status(200)');
  expect(section).not.toContain('res.status(201)');
}

describe('sanctions screening evidence boundaries', () => {
  it('retires AI screening after role and target-tenancy checks', () => {
    const section = routeSection(
      aiRouteSource,
      '// POST /ai/compliance/screen',
      '// POST /ai/compliance/report',
    );

    expect(aiRouteSource).toContain(
      "error: 'AUTHORITATIVE_SANCTIONS_SCREENING_UNAVAILABLE'",
    );
    expect(aiRouteSource).toContain('res.status(503)');
    expect(section).toContain('requireEnterpriseContext(COMPLIANCE_WRITE_ROLES)');
    expect(section).toContain('requireIdentityTarget(req, res, req.body.identityId)');
    expect(section).toContain('sendSanctionsScreeningUnavailable(res)');
    expect(section).not.toContain('screenIdentity(');
    expect(section).not.toContain('success: true');
  });

  it('retires single and batch enterprise screening without receipts or mutations', () => {
    const singleSection = routeSection(
      enterpriseRouteSource,
      '// POST /enterprise/compliance/screen — Sanctions screening',
      '// POST /enterprise/compliance/screen/batch — Batch screening',
    );
    const batchSection = routeSection(
      enterpriseRouteSource,
      '// POST /enterprise/compliance/screen/batch — Batch screening',
      '// POST /enterprise/compliance/screen/resolve — Resolve false positive',
    );

    expect(enterpriseRouteSource).toContain(
      "code: 'AUTHORITATIVE_SANCTIONS_SCREENING_UNAVAILABLE'",
    );
    expect(enterpriseRouteSource).toContain('res.status(503)');
    expectRetiredEnterpriseScreeningRoute(singleSection);
    expectRetiredEnterpriseScreeningRoute(batchSection);
  });

  it('retires match resolution before touching the non-durable screening store', () => {
    const section = routeSection(
      enterpriseRouteSource,
      '// POST /enterprise/compliance/screen/resolve — Resolve false positive',
      '// GET /enterprise/compliance/status/:entityId — Compliance status',
    );

    expectRetiredEnterpriseScreeningRoute(section);
    expect(section).not.toContain('resolveMatch(');
  });

  it('does not expose screening history from the process/file-backed store', () => {
    const section = routeSection(
      enterpriseRouteSource,
      '// GET /enterprise/compliance/status/:entityId — Compliance status',
      '// POST /enterprise/compliance/evaluate — Evaluate compliance for entity',
    );

    expect(section).toContain('requireEnterpriseContext(');
    expect(section).toContain('requireReceiptContext(req, res)');
    expect(section).toContain('sendSanctionsScreeningUnavailable(res)');
    expect(section).not.toContain('getEntityScreenings(');
    expect(section).not.toContain('res.status(200)');
  });
});
