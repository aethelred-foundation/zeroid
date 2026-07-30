#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ADDRESS_FIELDS = Object.freeze([
  ["identityRegistry", "NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS"],
  ["zkVerifier", "NEXT_PUBLIC_ZK_VERIFIER_ADDRESS"],
  ["accumulatorRevocation", "NEXT_PUBLIC_ACCUMULATOR_REVOCATION_ADDRESS"],
  ["governanceModule", "NEXT_PUBLIC_GOVERNANCE_MODULE_ADDRESS"],
  ["credentialRegistry", "NEXT_PUBLIC_CREDENTIAL_REGISTRY_ADDRESS"],
  ["selectiveDisclosure", "NEXT_PUBLIC_SELECTIVE_DISCLOSURE_ADDRESS"],
]);

const MANAGED_START = "# BEGIN ZEROID DEPLOYMENT ADDRESSES";
const MANAGED_END = "# END ZEROID DEPLOYMENT ADDRESSES";
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

function parseChainId(value, label) {
  const chainId =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return chainId;
}

export function validateDeploymentManifest(manifest, expectedChainId) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("deployment manifest must be a JSON object");
  }

  const chainId = parseChainId(manifest.chainId, "manifest.chainId");
  if (
    expectedChainId !== undefined &&
    chainId !== parseChainId(expectedChainId, "expected chain ID")
  ) {
    throw new Error(
      `manifest chain ID ${chainId} does not match expected chain ID ${expectedChainId}`,
    );
  }

  const addresses = {};
  for (const [field, envName] of ADDRESS_FIELDS) {
    const value = manifest[field];
    if (typeof value !== "string" || !ADDRESS_PATTERN.test(value)) {
      throw new Error(`manifest.${field} must be a 20-byte EVM address`);
    }
    if (value.toLowerCase() === ZERO_ADDRESS) {
      throw new Error(`manifest.${field} must not be the zero address`);
    }
    addresses[envName] = value;
  }

  if (
    new Set(Object.values(addresses).map((value) => value.toLowerCase()))
      .size !== ADDRESS_FIELDS.length
  ) {
    throw new Error(
      "deployment manifest contains duplicate contract addresses",
    );
  }

  return { chainId, addresses };
}

export function renderDeploymentEnv(manifest, expectedChainId) {
  const { chainId, addresses } = validateDeploymentManifest(
    manifest,
    expectedChainId,
  );
  const lines = [
    MANAGED_START,
    `# chainId=${chainId}`,
    ...ADDRESS_FIELDS.map(([, envName]) => `${envName}=${addresses[envName]}`),
    MANAGED_END,
  ];
  return `${lines.join("\n")}\n`;
}

function removeManagedBlock(lines) {
  const output = [];
  let insideManagedBlock = false;

  for (const line of lines) {
    if (line === MANAGED_START) {
      insideManagedBlock = true;
      continue;
    }
    if (line === MANAGED_END) {
      insideManagedBlock = false;
      continue;
    }
    if (!insideManagedBlock) output.push(line);
  }

  if (insideManagedBlock) {
    throw new Error(
      `environment file contains ${MANAGED_START} without ${MANAGED_END}`,
    );
  }
  return output;
}

export function updateEnvironmentText(currentText, manifest, expectedChainId) {
  const managedKeys = new Set(ADDRESS_FIELDS.map(([, envName]) => envName));
  const lines = removeManagedBlock(currentText.split(/\r?\n/)).filter(
    (line) => {
      const match = line.match(/^([A-Z0-9_]+)=/);
      return !match || !managedKeys.has(match[1]);
    },
  );

  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  return `${lines.join("\n")}\n\n${renderDeploymentEnv(manifest, expectedChainId)}`;
}

function parseArgs(argv) {
  const args = { print: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--print") {
      args.print = true;
    } else if (arg === "--manifest") {
      args.manifest = argv[++index];
    } else if (arg === "--env") {
      args.env = argv[++index];
    } else if (arg === "--chain-id") {
      args.chainId = argv[++index];
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.manifest || !args.chainId) {
    throw new Error(
      "usage: apply-deployment-manifest.mjs --manifest <json> --chain-id <id> (--env <file> | --print)",
    );
  }
  if (args.print === Boolean(args.env)) {
    throw new Error("choose exactly one of --env <file> or --print");
  }

  const manifestPath = path.resolve(args.manifest);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  if (args.print) {
    process.stdout.write(renderDeploymentEnv(manifest, args.chainId));
    return;
  }

  const envPath = path.resolve(args.env);
  const currentText = fs.readFileSync(envPath, "utf8");
  const updatedText = updateEnvironmentText(
    currentText,
    manifest,
    args.chainId,
  );
  const mode = fs.statSync(envPath).mode;
  const temporaryPath = `${envPath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporaryPath, updatedText, { mode });
    fs.renameSync(temporaryPath, envPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }

  const { chainId } = validateDeploymentManifest(manifest, args.chainId);
  process.stdout.write(
    `Updated ${envPath} with six ZeroID addresses for chain ${chainId}.\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `Deployment manifest was not applied: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
