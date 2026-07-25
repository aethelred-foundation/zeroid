import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SDK_REPOSITORY =
  "https://github.com/aethelred-foundation/aethelred.git";
const SDK_REVISION = "bb4350573edbdc10185250a43455b4dd365eb813";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sdkRepositoryRoot = resolve(repositoryRoot, "..", "aethelred");
const sdkPackageRoot = join(sdkRepositoryRoot, "sdk", "typescript");

function run(command, args, cwd, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, CI: "true" },
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with ${result.status ?? "unknown status"}`,
    );
  }

  return capture ? result.stdout.trim() : "";
}

if (!existsSync(join(sdkPackageRoot, "package.json"))) {
  run(
    "git",
    [
      "clone",
      "--filter=blob:none",
      "--no-checkout",
      SDK_REPOSITORY,
      sdkRepositoryRoot,
    ],
    repositoryRoot,
  );
  run("git", ["sparse-checkout", "init", "--cone"], sdkRepositoryRoot);
  run(
    "git",
    ["sparse-checkout", "set", "sdk/typescript"],
    sdkRepositoryRoot,
  );
  run("git", ["checkout", "--detach", SDK_REVISION], sdkRepositoryRoot);

  const checkedOutRevision = run(
    "git",
    ["rev-parse", "HEAD"],
    sdkRepositoryRoot,
    { capture: true },
  );
  if (checkedOutRevision !== SDK_REVISION) {
    throw new Error(
      `Canonical SDK checkout mismatch: expected ${SDK_REVISION}, received ${checkedOutRevision}`,
    );
  }
}

run("npm", ["ci", "--no-audit", "--no-fund"], sdkPackageRoot);
run("npm", ["run", "build"], sdkPackageRoot);
run("npm", ["ci", "--no-fund"], repositoryRoot);
