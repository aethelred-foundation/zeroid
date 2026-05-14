import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROUTE_ROOT = new URL('../backend/src/routes/', import.meta.url);
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIRECT_SCHEMA_PATTERN = /\bvalidate\s*\(\s*[A-Za-z0-9_]+Schema\s*\)/g;

async function collectTypeScriptFiles(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(fileURLToPath(directoryUrl), entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(new URL(`${entry.name}/`, directoryUrl))));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

const violations = [];
const files = await collectTypeScriptFiles(ROUTE_ROOT);

for (const file of files) {
  const source = await readFile(file, 'utf8');
  const matches = source.matchAll(DIRECT_SCHEMA_PATTERN);
  for (const match of matches) {
    const line = source.slice(0, match.index).split('\n').length;
    const relativeFile = path.relative(REPO_ROOT, file);
    violations.push(`${relativeFile}:${line}: use validate({ body/query/params: Schema })`);
  }
}

if (violations.length > 0) {
  console.error('Route validation target check failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(`Route validation target check passed for ${files.length} route files.`);
