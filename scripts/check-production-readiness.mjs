import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const requireLive = process.argv.includes('--require-live');

const requiredFiles = [
  'circuits/manifest/eligibility_v1.json',
  'scripts/build-eligibility-artifacts.mjs',
  'docs/production/zeroid-v1-readiness-gate.md',
  'docs/zk/eligibility-artifact-ceremony.md',
  'docs/policies/eligibility_v1.md',
  'docs/security/key-custody.md',
  'docs/security/threat-model-v1.md',
  'docs/security/incident-response-runbook.md',
  'docs/compliance/dpia-v1.md',
  'docs/integrations/golden-enterprise-integration.md',
  'SECURITY.md',
];

const requiredPackageScripts = [
  'type-check',
  'test:ci',
  'test:e2e',
  'circuits:validate',
  'circuits:eligibility:build',
  'circuits:validate:artifacts',
  'routes:validate',
  'workflows:validate',
  'security:audit:all',
  'readiness:check',
  'readiness:production',
];

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function readText(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
}

function checkFile(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  return {
    control: `file:${relativePath}`,
    ok: existsSync(absolutePath) && statSync(absolutePath).size > 0,
  };
}

function checkPackageScripts() {
  const pkg = readJson('package.json');
  return requiredPackageScripts.map((script) => ({
    control: `package-script:${script}`,
    ok:
      typeof pkg.scripts?.[script] === 'string' &&
      pkg.scripts[script].length > 0,
  }));
}

function run(name, args) {
  const result = spawnSync(name, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function checkWorkflow() {
  const workflowPath = path.join(repoRoot, '.github/workflows/ci.yml');
  const workflow = existsSync(workflowPath)
    ? readFileSync(workflowPath, 'utf8')
    : '';
  const requiredSnippets = [
    'npm run readiness:check',
    'npm run circuits:validate',
    'npm run security:audit:all',
    'npm test',
    'forge test',
    'cargo test',
    'go test ./...',
  ];
  return requiredSnippets.map((snippet) => ({
    control: `ci:${snippet}`,
    ok: workflow.includes(snippet),
  }));
}

function checkFrontendSecurityHeaders() {
  const nextConfig = readText('next.config.js');
  const middleware = readText('src/middleware.ts');

  return [
    {
      control: 'frontend:csp-middleware-present',
      ok:
        middleware.includes('buildContentSecurityPolicy') &&
        middleware.includes('Content-Security-Policy'),
    },
    {
      control: 'frontend:csp-production-script-nonce',
      ok: middleware.includes("`script-src 'self' 'nonce-${nonce}'`"),
    },
    {
      control: 'frontend:csp-script-attributes-blocked',
      ok: middleware.includes("script-src-attr 'none'"),
    },
    {
      control: 'frontend:csp-frame-ancestors-deny',
      ok: middleware.includes("frame-ancestors 'none'"),
    },
    {
      control: 'frontend:csp-not-static-unsafe-inline',
      ok:
        !nextConfig.includes('Content-Security-Policy') &&
        !nextConfig.includes("script-src 'self' 'unsafe-inline'"),
    },
  ];
}

function checkFrontendArchitecture() {
  const layout = readText('src/app/layout.tsx').trimStart();
  const providers = readText('src/app/providers.tsx').trimStart();

  return [
    {
      control: 'frontend:server-root-layout',
      ok: !layout.startsWith('"use client"') && !layout.startsWith("'use client'"),
    },
    {
      control: 'frontend:isolated-client-providers',
      ok:
        providers.startsWith('"use client"') &&
        providers.includes('QueryClientProvider') &&
        providers.includes('WagmiProvider') &&
        providers.includes('IdentityProvider'),
    },
  ];
}

const checks = [
  ...requiredFiles.map(checkFile),
  ...checkPackageScripts(),
  ...checkWorkflow(),
  ...checkFrontendSecurityHeaders(),
  ...checkFrontendArchitecture(),
];

const circuitValidation = run('node', [
  'scripts/validate-circuit-artifacts.mjs',
]);
checks.push({
  control: 'circuits:manifest-source-validation',
  ok: circuitValidation.ok,
});

if (requireLive) {
  const artifactValidation = run('node', [
    'scripts/validate-circuit-artifacts.mjs',
    '--require-artifacts',
  ]);
  checks.push({
    control: 'circuits:pinned-production-artifacts',
    ok: artifactValidation.ok,
  });
}

const failed = checks.filter((check) => !check.ok);
const report = {
  ok: failed.length === 0,
  mode: requireLive ? 'production-live' : 'pre-production',
  checkedAt: new Date().toISOString(),
  checks,
  failed,
};

console.log(JSON.stringify(report, null, 2));

if (failed.length > 0) {
  process.exitCode = 1;
}
