#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// register-vkeys.mjs — register finalized Groth16 verification keys on-chain in
// ZKCredentialVerifier (setVerificationKey, CIRCUIT_MANAGER_ROLE).
//
// Consumes the vkeys produced by 05-finalize.sh (ceremony/artifacts/<c>_vkey.json).
// Invoked by 07-register-vkeys.sh.
//
// DRY-RUN by default: parses each vkey, validates every point is on-curve
// (< PRIME_Q), derives the canonical circuitId, and prints the exact calldata —
// WITHOUT touching a chain or needing a key. Pass --broadcast (with RPC_URL +
// CIRCUIT_MANAGER_PRIVATE_KEY + ZKVERIFIER_ADDRESS) to actually send.
//
// ── The G2 coordinate convention (the one thing that must not be "fixed") ─────
// snarkjs verification_key.json stores a G2 element c0 + c1·u as [c0, c1].
// The EVM ecPairing precompile (0x08) wants the imaginary part first: [c1, c0].
// ZKCredentialVerifier stores the key in snarkjs order and does the swap itself,
// at the assembly boundary (input[2]=b[0][1]; input[3]=b[0][0]). Therefore this
// script maps vk_beta_2 → beta element-for-element with NO reordering. Swapping
// here would double-swap and every proof would fail to verify.
//
// ── circuitId ─────────────────────────────────────────────────────────────────
// Canonical, reproducible, collision-resistant: circuitId = keccak256(utf8(name)),
// name being the compiled circuit basename (e.g. "age_proof"). The frontend must
// call verifyProof with the SAME id; this script prints every derived id and
// writes them to ceremony/artifacts/circuit-ids.json for the frontend to adopt.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  keccak256, toBytes, encodeFunctionData, createWalletClient, createPublicClient,
  http, defineChain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CEREMONY_DIR = join(HERE, '..');
const REPO_ROOT = join(CEREMONY_DIR, '..');
const VKEY_DIR = join(CEREMONY_DIR, 'artifacts');

// BN254 base-field prime — every coordinate the contract stores must be < this.
const PRIME_Q =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n;

// Ceremony circuit basename → whether it is frontend-facing (browser proving).
// eligibility_context_proof is the backend/on-chain policy circuit (no browser flow).
const CIRCUITS = ['eligibility_context_proof', 'age_proof', 'residency_proof', 'credit_tier_proof'];

const ABI = [
  {
    type: 'function', name: 'setVerificationKey', stateMutability: 'nonpayable',
    inputs: [
      { name: 'circuitId', type: 'bytes32' },
      { name: 'alpha', type: 'uint256[2]' },
      { name: 'beta', type: 'uint256[2][2]' },
      { name: 'gamma', type: 'uint256[2][2]' },
      { name: 'delta', type: 'uint256[2][2]' },
      { name: 'ic', type: 'uint256[2][]' },
    ],
    outputs: [],
  },
];

const circuitId = (name) => keccak256(toBytes(name));

/** Assert a field coordinate is a valid, on-curve-range base-field element. */
function fieldEl(x, where) {
  const v = BigInt(x);
  if (v < 0n || v >= PRIME_Q) throw new Error(`${where}: coordinate out of BN254 field range: ${x}`);
  return v;
}

/** snarkjs verification_key.json → setVerificationKey args (DIRECT G2 order). */
function mapVkey(vk, name) {
  if (vk.protocol !== 'groth16') throw new Error(`${name}: not a groth16 key (${vk.protocol})`);
  if (vk.curve !== 'bn128') throw new Error(`${name}: unexpected curve ${vk.curve}`);

  const g1 = (p, w) => [fieldEl(p[0], `${w}.x`), fieldEl(p[1], `${w}.y`)];
  const g2 = (p, w) => [
    [fieldEl(p[0][0], `${w}.x.c0`), fieldEl(p[0][1], `${w}.x.c1`)],
    [fieldEl(p[1][0], `${w}.y.c0`), fieldEl(p[1][1], `${w}.y.c1`)],
  ];

  const alpha = g1(vk.vk_alpha_1, 'alpha');
  const beta = g2(vk.vk_beta_2, 'beta');
  const gamma = g2(vk.vk_gamma_2, 'gamma');
  const delta = g2(vk.vk_delta_2, 'delta');
  const ic = vk.IC.map((p, i) => g1(p, `IC[${i}]`));

  // The contract requires ic.length >= 2 and, for a sound proof, one IC point
  // per public signal plus the constant term: IC.length === nPublic + 1.
  if (ic.length !== vk.nPublic + 1) {
    throw new Error(`${name}: IC length ${ic.length} != nPublic+1 (${vk.nPublic + 1})`);
  }
  if (ic.length < 2) throw new Error(`${name}: IC must have at least 2 points`);

  return { alpha, beta, gamma, delta, ic };
}

function loadVkey(name) {
  const p = join(VKEY_DIR, `${name}_vkey.json`);
  if (!existsSync(p)) throw new Error(`missing vkey: ${p}\nrun 05-finalize.sh first.`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

const bigintJson = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);

async function main() {
  const broadcast = process.argv.includes('--broadcast');
  const log = (...a) => console.log('[register-vkeys]', ...a);

  const idMap = {};
  const registrations = [];

  for (const name of CIRCUITS) {
    const vk = loadVkey(name);
    const args = mapVkey(vk, name);
    const id = circuitId(name);
    idMap[name] = id;
    const calldata = encodeFunctionData({ abi: ABI, functionName: 'setVerificationKey', args: [id, args.alpha, args.beta, args.gamma, args.delta, args.ic] });
    registrations.push({ name, id, args, calldata });

    log(`${name}`);
    log(`  circuitId = ${id}   (keccak256("${name}"))`);
    log(`  nPublic   = ${vk.nPublic}   IC points = ${args.ic.length}   ✓ on-curve, ✓ IC=nPublic+1`);
    log(`  calldata  = ${calldata.slice(0, 42)}… (${(calldata.length - 2) / 2} bytes)`);
  }

  // Emit the id map for the frontend to adopt (verifyProof must use these ids).
  const idsPath = join(VKEY_DIR, 'circuit-ids.json');
  writeFileSync(idsPath, JSON.stringify({ schema: 'zeroid.circuit_ids.v1', derivation: 'keccak256(utf8(circuitName))', ids: idMap }, bigintJson, 2) + '\n');
  log(`wrote derived circuit ids → ${idsPath.replace(REPO_ROOT + '/', '')}`);

  if (!broadcast) {
    log('DRY-RUN complete (no chain touched). Re-run with --broadcast to register on-chain.');
    return;
  }

  // ── broadcast ────────────────────────────────────────────────────────────
  const rpcUrl = process.env.RPC_URL;
  const pk = process.env.CIRCUIT_MANAGER_PRIVATE_KEY;
  const verifier = process.env.ZKVERIFIER_ADDRESS;
  const chainId = Number(process.env.CHAIN_ID ?? 7332);
  if (!rpcUrl || !pk || !verifier) {
    throw new Error('--broadcast needs RPC_URL, CIRCUIT_MANAGER_PRIVATE_KEY, ZKVERIFIER_ADDRESS');
  }
  const chain = defineChain({ id: chainId, name: `aethelred-${chainId}`, nativeCurrency: { name: 'AETHEL', symbol: 'AETHEL', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const pub = createPublicClient({ chain, transport: http(rpcUrl) });

  for (const r of registrations) {
    log(`broadcasting setVerificationKey(${r.name}) → ${verifier}`);
    // Aethelred charges max(actualGas, gasLimit/2); over-provision the limit so a
    // tight estimate is not the fee floor (see chain evm-gas-and-fees guide).
    const gas = await pub.estimateGas({ account, to: verifier, data: r.calldata });
    const hash = await wallet.sendTransaction({ to: verifier, data: r.calldata, gas: gas * 2n });
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    log(`  ${r.name}: ${rcpt.status} in block ${rcpt.blockNumber}  tx=${hash}`);
    if (rcpt.status !== 'success') throw new Error(`${r.name}: registration reverted`);
  }
  log('all verification keys registered on-chain ✓');
}

main().catch((e) => { console.error('[register-vkeys] ERROR:', e.message); process.exit(1); });
