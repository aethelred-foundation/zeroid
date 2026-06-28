#!/usr/bin/env node
/**
 * Aethelred conformance boundary guard.
 *
 * Enforces the strangler-fig invariant: ALL canonical chain access goes through
 * `src/lib/aethelred/`. Any other file importing `@aethelred/sdk` (root or a
 * subpath) is a conformance violation — it bypasses the boundary and risks the
 * cross-app divergence this migration exists to eliminate.
 *
 * Exits non-zero (failing CI) when a violation is found.
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SRC_ROOT = new URL("../src/", import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const BOUNDARY_DIR = path.join(REPO_ROOT, "src", "lib", "aethelred");
const IMPORT_PATTERN = /from\s+['"]@aethelred\/sdk(?:\/[^'"]*)?['"]/;

async function collectFiles(dirUrl) {
  const entries = await readdir(dirUrl, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(new URL(`${entry.name}/`, dirUrl))));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(path.join(fileURLToPath(dirUrl), entry.name));
    }
  }
  return files;
}

const files = await collectFiles(SRC_ROOT);
const violations = [];
for (const file of files) {
  if (file.startsWith(BOUNDARY_DIR + path.sep)) continue;
  const content = await readFile(file, "utf8");
  if (IMPORT_PATTERN.test(content)) {
    violations.push(path.relative(REPO_ROOT, file));
  }
}

if (violations.length > 0) {
  console.error("✖ Aethelred conformance boundary violated.");
  console.error(
    "  These files import @aethelred/sdk directly. All canonical chain",
  );
  console.error("  access must go through src/lib/aethelred/:");
  for (const v of violations) console.error(`    - ${v}`);
  process.exit(1);
}

console.log(
  `✓ Aethelred boundary intact: ${files.length} files scanned; ` +
    "all @aethelred/sdk imports confined to src/lib/aethelred/.",
);
