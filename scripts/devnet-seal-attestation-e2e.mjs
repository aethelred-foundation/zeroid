#!/usr/bin/env node
/**
 * ZeroID seal-anchored identity E2E — the consensus-anchored credential, live.
 *
 * Proves the identity flow no allowlist/oracle KYC can offer: a credential
 * admitted only when a Digital Seal minted by the chain's own attested-compute
 * (PoUW) pipeline exists, is ACTIVE, is bound to THIS subject + schema, and
 * satisfies the CEAP policy — all checked by consensus logic via the ISeal
 * precompile (0x0900):
 *
 *   1. deploy SealAttestationRegistry(governance) (or reuse REGISTRY_ADDRESS)
 *   2. governance sets the CEAP policy (fhe backend, EU residency)
 *   3. isCredentialValid(subject, schema) === false — no seal yet
 *   4. a PoUW compliance job runs on-chain with purpose
 *      `zeroid:0x<schema>:0x<subject>` → validators verify → quorum mints the
 *      Digital Seal (driven by the operator via the aethelredd CLI; this
 *      script prints the exact command, including the contract's own
 *      expectedPurpose())
 *   5. attest(schema, JOB_ID) verifies the seal via ISeal (ACTIVE + purpose
 *      bound to THIS subject + schema + CEAP policy satisfied) and records the
 *      credential; isCredentialValid flips true
 *
 * This is an operator playbook: it automates every EVM-side step and, when the
 * PoUW seal is ready, pass its JOB_ID to complete issuance. Without JOB_ID it
 * stops after proving no-seal-no-credential and printing the mint command.
 *
 * The definitive seal-binding proof (real ISeal precompile + real seal keeper +
 * this exact bytecode, incl. live revocation) lives in the aethelred repo at
 * internal/evmhost/zeroid_test.go — this script is the live-node counterpart.
 *
 * Env: DEPLOYER_KEY (funded; also governance), RPC_URL (default
 *      http://127.0.0.1:8545), REGISTRY_ADDRESS (optional; deploys if unset),
 *      SCHEMA (optional bytes32 hex; default keccak256("kyc-tier-2")),
 *      SUBJECT (optional; default = deployer), JOB_ID (completed PoUW job).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeDeployData,
  http,
  keccak256,
  stringToBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const artifactPath = join(
  __dirname,
  "..",
  "foundry-out",
  "SealAttestationRegistry.sol",
  "SealAttestationRegistry.json",
);

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const DEPLOYER_KEY = process.env.DEPLOYER_KEY;
const JOB_ID = process.env.JOB_ID ?? "";

if (!DEPLOYER_KEY) {
  console.error(
    "DEPLOYER_KEY is required (funded account; also used as governance).",
  );
  console.error("Compile first: forge build  (produces foundry-out/…)");
  process.exit(2);
}

const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const abi = artifact.abi;
const bytecode = artifact.bytecode?.object ?? artifact.bytecode;
if (!bytecode || bytecode === "0x") {
  console.error(`No creation bytecode in ${artifactPath}; run 'forge build'.`);
  process.exit(2);
}

const chain = defineChain({
  id: 7332,
  name: "Aethelred Devnet",
  nativeCurrency: { name: "AETHEL", symbol: "AETHEL", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

const account = privateKeyToAccount(DEPLOYER_KEY);
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const walletClient = createWalletClient({
  account,
  chain,
  transport: http(RPC_URL),
});

const SUBJECT = (process.env.SUBJECT ?? account.address).toLowerCase();
const SCHEMA = process.env.SCHEMA ?? keccak256(stringToBytes("kyc-tier-2"));

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};
const step = (msg) => console.log(`\n== ${msg}`);

let REGISTRY_ADDRESS = process.env.REGISTRY_ADDRESS;

// Aethelred's cosmos/evm EVM charges max(actualGas, gasLimit/2) — a refund of
// more than half the gas limit is capped — so an over-large fixed limit
// overpays (e.g. a 3M limit is billed 1.5M even for a ~130k call). Its
// eth_estimateGas is accurate for settled state, so the limit is 2x the estimate
// (the fee stays at the true cost, with 100% headroom), floored for safety.
// Keeping estimation on the path makes a disallowed call throw here rather than
// mine a failed tx; the floor covers the window where the estimate momentarily
// lags just-committed state (e.g. right after a deploy) and would under-shoot.
// WRITE_GAS/DEPLOY_GAS override the estimate entirely if ever needed.
const WRITE_GAS = process.env.WRITE_GAS ? BigInt(process.env.WRITE_GAS) : null;
const DEPLOY_GAS = process.env.DEPLOY_GAS ? BigInt(process.env.DEPLOY_GAS) : null;
const FLOOR_WRITE = 800_000n;
const FLOOR_DEPLOY = 6_000_000n;
const withHeadroom = (estimate, floor) => {
  const doubled = estimate * 2n;
  return doubled > floor ? doubled : floor;
};

async function write(functionName, args = []) {
  const gas =
    WRITE_GAS ??
    withHeadroom(
      await publicClient.estimateContractGas({
        address: REGISTRY_ADDRESS,
        abi,
        functionName,
        args,
        account,
      }),
      FLOOR_WRITE,
    );
  const hash = await walletClient.writeContract({
    address: REGISTRY_ADDRESS,
    abi,
    functionName,
    args,
    gas,
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: 60_000,
  });
  if (receipt.status !== "success") fail(`${functionName} reverted on-chain`);
  return receipt;
}

const read = (functionName, args = []) =>
  publicClient.readContract({
    address: REGISTRY_ADDRESS,
    abi,
    functionName,
    args,
  });

async function main() {
  step("chain identity");
  const chainId = await publicClient.getChainId();
  if (chainId !== 7332) fail(`chain id ${chainId}, want 7332`);
  console.log(`eth_chainId: ${chainId}`);
  console.log(`subject: ${SUBJECT}`);
  console.log(`schema:  ${SCHEMA}`);

  if (!REGISTRY_ADDRESS) {
    step("deploy SealAttestationRegistry(governance = deployer)");
    const deployGas =
      DEPLOY_GAS ??
      withHeadroom(
        await publicClient.estimateGas({
          account,
          data: encodeDeployData({ abi, bytecode, args: [account.address] }),
        }),
        FLOOR_DEPLOY,
      );
    const hash = await walletClient.deployContract({
      abi,
      bytecode,
      args: [account.address],
      gas: deployGas,
    });
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 60_000,
    });
    if (receipt.status !== "success" || !receipt.contractAddress) {
      fail("deployment reverted");
    }
    REGISTRY_ADDRESS = receipt.contractAddress;
    console.log(`deployed at ${REGISTRY_ADDRESS}`);
  } else {
    console.log(`\nusing REGISTRY_ADDRESS ${REGISTRY_ADDRESS}`);
  }

  step("governance: set CEAP policy (fhe backend, EU residency)");
  await write("setCompliancePolicy", [["fhe"], "", [], false, ["EU"]]);
  const policy = await read("compliancePolicy");
  console.log(
    `policy read-back: backends=${JSON.stringify(policy[0])} residency=${JSON.stringify(policy[4])}`,
  );

  step("no seal yet: isCredentialValid must be false");
  const before = await read("isCredentialValid", [SUBJECT, SCHEMA]);
  if (before) fail("credential valid before any seal — gate is not closed");
  console.log("isCredentialValid = false (no consensus anchor) ✓");

  // The contract itself is the source of truth for the required purpose string.
  const expected = await read("expectedPurpose", [SUBJECT, SCHEMA]);

  if (!JOB_ID) {
    step("mint the backing seal (operator step)");
    console.log(
      "Run a PoUW compliance job whose purpose binds this subject + schema, then",
    );
    console.log("re-run with JOB_ID set:\n");
    console.log(
      `  aethelredd tx pouw register-model --model zeroid-kyc-v1 --model-id zeroid-kyc \\\n` +
        `    --from validator --chain-id <id> --keyring-backend test --yes`,
    );
    console.log(
      `  aethelredd tx pouw submit-job --model zeroid-kyc-v1 --input applicant-${SUBJECT} \\\n` +
        `    --proof-type tee --purpose "${expected}" \\\n` +
        `    --conf-backends fhe --conf-residency EU \\\n` +
        `    --from validator --chain-id <id> --keyring-backend test --yes`,
    );
    console.log(
      `\nWait for the quorum-minted seal, then:\n  JOB_ID=<job-id> REGISTRY_ADDRESS=${REGISTRY_ADDRESS} \\\n` +
        `    DEPLOYER_KEY=<key> node scripts/devnet-seal-attestation-e2e.mjs`,
    );
    console.log(
      "\nGATE PROVEN CLOSED. Provide JOB_ID to complete consensus-anchored issuance.",
    );
    return;
  }

  step(`attest(schema, ${JOB_ID}) — verify seal via ISeal + record credential`);
  await write("attest", [SCHEMA, JOB_ID]);
  const after = await read("isCredentialValid", [SUBJECT, SCHEMA]);
  if (!after) fail("credential not valid after attest");
  console.log("isCredentialValid = true (anchored to Digital Seal) ✓");

  step("requireCredential must not revert for the anchored subject");
  await read("requireCredential", [SUBJECT, SCHEMA]);
  console.log("requireCredential passed ✓");

  console.log(
    "\nCONSENSUS-ANCHORED IDENTITY LIVE: no seal → no credential; " +
      "quorum-minted, subject+schema-bound, policy-satisfying seal → credential. " +
      "Revoke the seal on-chain and isCredentialValid flips false with no ZeroID tx.",
  );
}

main().catch((e) => fail(e.shortMessage ?? e.message ?? String(e)));
