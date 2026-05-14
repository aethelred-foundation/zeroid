import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const WORKFLOW_ROOT = new URL('../.github/workflows/', import.meta.url);
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const USES_PATTERN = /^\s*-?\s*uses:\s*['"]?([^'"\s#]+)['"]?/;
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;

const workflowFiles = (await readdir(WORKFLOW_ROOT, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
  .map((entry) => path.join(fileURLToPath(WORKFLOW_ROOT), entry.name))
  .sort();

const violations = [];

for (const file of workflowFiles) {
  const source = await readFile(file, 'utf8');
  const relativeFile = path.relative(REPO_ROOT, file);
  const lines = source.split('\n');

  lines.forEach((line, index) => {
    const match = line.match(USES_PATTERN);
    if (!match) return;

    const actionRef = match[1];
    if (actionRef.startsWith('./')) return;

    const separatorIndex = actionRef.lastIndexOf('@');
    const ref = separatorIndex >= 0 ? actionRef.slice(separatorIndex + 1) : '';
    if (!FULL_SHA_PATTERN.test(ref)) {
      violations.push(
        `${relativeFile}:${index + 1}: pin external action to a full commit SHA (${actionRef})`,
      );
    }
  });
}

if (violations.length > 0) {
  console.error('Workflow action pinning check failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(
  `Workflow action pinning check passed for ${workflowFiles.length} workflow files.`,
);
