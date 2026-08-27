import { createHash } from "crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const requireArtifacts = process.argv.includes("--require-artifacts");
const manifestDir = "circuits/manifest";

function absolute(relativePath) {
  return path.join(repoRoot, relativePath);
}

function sha256File(relativePath) {
  return createHash("sha256")
    .update(readFileSync(absolute(relativePath)))
    .digest("hex");
}

function stableSerialize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
    .join(",")}}`;
}

function sha256Value(value) {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readManifestFiles() {
  const dir = absolute(manifestDir);
  assert(
    existsSync(dir),
    `Circuit manifest directory missing at ${manifestDir}`,
  );

  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort();

  assert(
    files.length > 0,
    `No circuit manifest JSON files found in ${manifestDir}`,
  );

  return files.map((file) => {
    const relativePath = path.join(manifestDir, file);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(absolute(relativePath), "utf8"));
    } catch (error) {
      throw new Error(
        `${relativePath}: manifest JSON is invalid: ${error.message}`,
      );
    }
    validateManifestShape(relativePath, parsed);
    return {
      ...parsed,
      manifestPath: relativePath,
      manifestDigest: sha256Value(parsed),
    };
  });
}

function validateManifestShape(relativePath, manifest) {
  assert(
    manifest && typeof manifest === "object" && !Array.isArray(manifest),
    `${relativePath}: manifest must be an object`,
  );
  assert(
    manifest.schema === "zeroid.circuit_manifest.v1",
    `${relativePath}: unsupported schema ${manifest.schema}`,
  );
  for (const field of [
    "name",
    "version",
    "policyId",
    "circuitId",
    "circuitName",
    "verificationKeyId",
    "source",
  ]) {
    assert(
      typeof manifest[field] === "string" && manifest[field].trim().length > 0,
      `${relativePath}: ${field} must be a non-empty string`,
    );
  }
  assert(
    Array.isArray(manifest.publicSignals) &&
      manifest.publicSignals.every((signal) => typeof signal === "string"),
    `${relativePath}: publicSignals must be a string array`,
  );
  assert(
    manifest.publicSignals[0] === "claimsHash" &&
      manifest.publicSignals[manifest.publicSignals.length - 1] ===
        "contextCommitment",
    `${relativePath}: context-bound public signals must start with claimsHash and end with contextCommitment`,
  );
  assert(
    Array.isArray(manifest.privateInputsRedacted) &&
      manifest.privateInputsRedacted.every(
        (input) => typeof input === "string",
      ),
    `${relativePath}: privateInputsRedacted must be a string array`,
  );
  assert(
    manifest.artifacts &&
      typeof manifest.artifacts === "object" &&
      !Array.isArray(manifest.artifacts),
    `${relativePath}: artifacts must be an object`,
  );
}

function validateSource(manifest) {
  const sourcePath = absolute(manifest.source);
  assert(
    existsSync(sourcePath),
    `${manifest.name}: source missing at ${manifest.source}`,
  );

  const source = readFileSync(sourcePath, "utf8");
  const expectedPublicDeclaration = `component main {public [${manifest.publicSignals.join(
    ", ",
  )}]}`;

  assert(
    source.includes(expectedPublicDeclaration),
    `${manifest.name}: source public signal declaration must be ${expectedPublicDeclaration}`,
  );

  if (manifest.noPublicOutputs) {
    assert(
      !source.includes("signal output"),
      `${manifest.name}: context-bound verifier expects no public outputs after contextCommitment`,
    );
  }

  return {
    source: manifest.source,
    sha256: sha256File(manifest.source),
  };
}

function validateArtifactFile(manifest, label, relativePath) {
  const artifactPath = absolute(relativePath);
  assert(
    existsSync(artifactPath),
    `${manifest.name}: ${label} artifact missing at ${relativePath}`,
  );

  const stat = statSync(artifactPath);
  assert(stat.size > 0, `${manifest.name}: ${label} artifact is empty`);

  return {
    path: relativePath,
    bytes: stat.size,
    sha256: sha256File(relativePath),
  };
}

function validateVerificationKey(manifest, relativePath) {
  const artifact = validateArtifactFile(
    manifest,
    "verification key",
    relativePath,
  );
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolute(relativePath), "utf8"));
  } catch (error) {
    throw new Error(
      `${manifest.name}: verification key JSON is invalid: ${error.message}`,
    );
  }

  assert(
    Number(parsed.nPublic) === manifest.publicSignals.length,
    `${manifest.name}: verification key nPublic=${parsed.nPublic} does not match schema length ${manifest.publicSignals.length}`,
  );

  return artifact;
}

const report = [];

try {
  const manifests = readManifestFiles();
  for (const manifest of manifests) {
    const entry = {
      name: manifest.name,
      version: manifest.version,
      policyId: manifest.policyId,
      circuitId: manifest.circuitId,
      circuitName: manifest.circuitName,
      verificationKeyId: manifest.verificationKeyId,
      publicSignals: manifest.publicSignals,
      privateInputsRedacted: manifest.privateInputsRedacted,
      manifest: {
        path: manifest.manifestPath,
        sha256: manifest.manifestDigest,
      },
      source: validateSource(manifest),
      artifactsReady: false,
      artifacts: {},
    };

    const artifactEntries = Object.entries(manifest.artifacts);
    const missingArtifacts = artifactEntries.filter(
      ([, relativePath]) => !existsSync(absolute(relativePath)),
    );

    if (missingArtifacts.length > 0) {
      if (requireArtifacts) {
        throw new Error(
          `${manifest.name}: missing artifacts: ${missingArtifacts
            .map(([label]) => label)
            .join(", ")}`,
        );
      }
      entry.missingArtifacts = missingArtifacts.map(
        ([label, relativePath]) => ({
          label,
          path: relativePath,
        }),
      );
      report.push(entry);
      continue;
    }

    for (const [label, relativePath] of artifactEntries) {
      entry.artifacts[label] =
        label === "vkey"
          ? validateVerificationKey(manifest, relativePath)
          : validateArtifactFile(manifest, label, relativePath);
    }
    entry.artifactsReady = true;
    report.push(entry);
  }

  console.log(
    JSON.stringify({ ok: true, requireArtifacts, circuits: report }, null, 2),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        requireArtifacts,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
