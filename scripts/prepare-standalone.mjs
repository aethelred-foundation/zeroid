import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = process.cwd();
const standaloneRoot = path.join(repositoryRoot, ".next", "standalone");

async function requireDirectory(directory, description) {
  try {
    if (!(await stat(directory)).isDirectory()) {
      throw new Error("not a directory");
    }
  } catch {
    throw new Error(
      `${description} is missing at ${directory}. The Next.js build did not produce a complete standalone bundle.`,
    );
  }
}

await requireDirectory(standaloneRoot, "Standalone server output");
await requireDirectory(
  path.join(repositoryRoot, ".next", "static"),
  "Next.js static assets",
);
await requireDirectory(path.join(repositoryRoot, "public"), "Public assets");

await mkdir(path.join(standaloneRoot, ".next"), { recursive: true });
await cp(
  path.join(repositoryRoot, ".next", "static"),
  path.join(standaloneRoot, ".next", "static"),
  { recursive: true, force: true },
);
await cp(
  path.join(repositoryRoot, "public"),
  path.join(standaloneRoot, "public"),
  {
    recursive: true,
    force: true,
  },
);

console.log("Prepared standalone frontend assets in .next/standalone");
