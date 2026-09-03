/**
 * Operator smoke tool for the identity registry verifier.
 *
 *   node dist/ops/identity-registry-smoke.js --probe
 *   node dist/ops/identity-registry-smoke.js <txHash> <did> <controller> <recoveryHash> [--dump <dir>]
 *
 * `--probe` proves that this host can reach AETHELRED_RPC_URL, that the node
 * serves AETHELRED_CHAIN_ID and that IDENTITY_REGISTRY_ADDRESS holds code.
 * The four-argument form runs the exact verification the API performs for a
 * real registration and prints either the verified evidence or the refusal
 * code. `--dump` writes the raw receipt, transaction and block JSON so live
 * responses can be kept as fixtures.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createIdentityRegistryProvider,
  destroyProvider,
  ensureIdentityRegistryDeployed,
  loadIdentityRegistryConfiguration,
} from '../lib/identity-registry-config';
import { verifyIdentityRegistration } from '../services/identity-registry-verification';

const USAGE =
  'usage: identity-registry-smoke --probe | <txHash> <did> <controller> <recoveryHash> [--dump <dir>]';

function toJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, item) => (typeof item === 'bigint' ? item.toString() : item),
    2,
  );
}

async function probe(): Promise<number> {
  const config = loadIdentityRegistryConfiguration();
  const provider = createIdentityRegistryProvider(config);
  try {
    const network = await provider.getNetwork();
    const code = await provider.getCode(config.registryAddress);
    process.stdout.write(
      toJson({
        rpcUrl: config.rpcUrl,
        expectedChainId: config.chainId.toString(),
        observedChainId: network.chainId.toString(),
        registryAddress: config.registryAddress,
        registryCodeBytes: Math.max(0, (code.length - 2) / 2),
        minimumConfirmations: config.minimumConfirmations,
        receiptWaitMs: config.receiptWaitMs,
        allowedDidNetworks: config.allowedDidNetworks,
        anchorConfigured: config.networkAnchorBlock !== undefined,
      }) + '\n',
    );
    if (network.chainId !== config.chainId) {
      process.stderr.write('chain id mismatch\n');
      return 2;
    }
    await ensureIdentityRegistryDeployed(provider, config.registryAddress);
    return 0;
  } finally {
    destroyProvider(provider);
  }
}

async function dumpEvidence(dir: string, txHash: string): Promise<void> {
  const config = loadIdentityRegistryConfiguration();
  const provider = createIdentityRegistryProvider(config);
  try {
    const receipt = await provider.getTransactionReceipt(txHash);
    const transaction = await provider.getTransaction(txHash);
    const block = receipt ? await provider.getBlock(receipt.blockNumber) : null;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'receipt.json'), toJson(receipt?.toJSON() ?? null));
    await writeFile(
      join(dir, 'transaction.json'),
      toJson(transaction?.toJSON() ?? null),
    );
    await writeFile(join(dir, 'block.json'), toJson(block?.toJSON() ?? null));
  } finally {
    destroyProvider(provider);
  }
}

async function verify(args: string[]): Promise<number> {
  const [txHash, did, controller, recoveryHash] = args;
  const config = loadIdentityRegistryConfiguration();
  const provider = createIdentityRegistryProvider(config);
  try {
    const evidence = await verifyIdentityRegistration(
      { txHash, did, controller, recoveryHash },
      config,
      provider,
    );
    process.stdout.write(toJson(evidence) + '\n');
    return 0;
  } catch (error) {
    const failure = error as { code?: string; statusCode?: number; message?: string };
    process.stdout.write(
      toJson({
        code: failure.code ?? 'UNKNOWN',
        statusCode: failure.statusCode ?? 500,
        message: failure.message,
      }) + '\n',
    );
    return 1;
  } finally {
    destroyProvider(provider);
  }
}

export async function main(argv: string[]): Promise<number> {
  if (argv.includes('--probe')) return probe();

  const dumpIndex = argv.indexOf('--dump');
  const dumpDir = dumpIndex >= 0 ? argv[dumpIndex + 1] : undefined;
  const positional = argv.filter(
    (arg, index) => arg !== '--dump' && index !== dumpIndex + 1,
  );
  if (positional.length !== 4) {
    process.stderr.write(`${USAGE}\n`);
    return 64;
  }
  if (dumpIndex >= 0) {
    if (!dumpDir) {
      process.stderr.write(`${USAGE}\n`);
      return 64;
    }
    await dumpEvidence(dumpDir, positional[0]);
  }
  return verify(positional);
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exit(1);
    });
}
