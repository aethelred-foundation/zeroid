/**
 * ZeroID — Aethelred Conformance Boundary: ConditionalDisclosure contract client
 *
 * The on-chain half of conditional disclosure: typed ABI + thin viem wrappers
 * for `contracts/ConditionalDisclosure.sol` (deployed on Aethelred's EVM). Ties
 * the off-chain key-split escrow (`disclosure.ts`) to the on-chain compliance
 * quorum — register the ciphertext commitment, drive the warrant-bound quorum,
 * and read authorisation.
 *
 * Runs on the EVM contract plane (viem), distinct from the canonical Cosmos-REST
 * plane used elsewhere in the boundary.
 */

import type { Address, Hex } from "viem";

export const conditionalDisclosureAbi = [
  {
    type: "function",
    name: "registerEscrow",
    stateMutability: "nonpayable",
    inputs: [
      { name: "escrowId", type: "bytes32" },
      { name: "commitment", type: "bytes32" },
      { name: "subjectNullifier", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "requestDisclosure",
    stateMutability: "nonpayable",
    inputs: [
      { name: "escrowId", type: "bytes32" },
      { name: "warrantHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "approveDisclosure",
    stateMutability: "nonpayable",
    inputs: [{ name: "escrowId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "isDisclosureAuthorized",
    stateMutability: "view",
    inputs: [{ name: "escrowId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "eraseEscrow",
    stateMutability: "nonpayable",
    inputs: [{ name: "escrowId", type: "bytes32" }],
    outputs: [],
  },
] as const;

/** Minimal viem-compatible runner (a real WalletClient/PublicClient satisfies this). */
export interface DisclosureContractRunner {
  address: Address;
  writeContract(args: {
    address: Address;
    abi: typeof conditionalDisclosureAbi;
    functionName: string;
    args: readonly unknown[];
  }): Promise<Hex>;
  readContract(args: {
    address: Address;
    abi: typeof conditionalDisclosureAbi;
    functionName: string;
    args: readonly unknown[];
  }): Promise<unknown>;
}

/** Ensure a 0x-prefixed bytes32 from a (possibly bare) sha256 hex digest. */
export function commitmentToBytes32(commitmentHex: string): Hex {
  return (
    commitmentHex.startsWith("0x") ? commitmentHex : `0x${commitmentHex}`
  ) as Hex;
}

export interface RegisterEscrowParams {
  escrowId: Hex;
  commitment: Hex;
  subjectNullifier: Hex;
}

/** Anchor an escrow commitment on-chain (zero PII). */
export function registerEscrowOnChain(
  runner: DisclosureContractRunner,
  params: RegisterEscrowParams,
): Promise<Hex> {
  return runner.writeContract({
    address: runner.address,
    abi: conditionalDisclosureAbi,
    functionName: "registerEscrow",
    args: [params.escrowId, params.commitment, params.subjectNullifier],
  });
}

/** Open a warrant-bound disclosure request. */
export function requestDisclosureOnChain(
  runner: DisclosureContractRunner,
  escrowId: Hex,
  warrantHash: Hex,
): Promise<Hex> {
  return runner.writeContract({
    address: runner.address,
    abi: conditionalDisclosureAbi,
    functionName: "requestDisclosure",
    args: [escrowId, warrantHash],
  });
}

/** Submit a compliance-officer approval. */
export function approveDisclosureOnChain(
  runner: DisclosureContractRunner,
  escrowId: Hex,
): Promise<Hex> {
  return runner.writeContract({
    address: runner.address,
    abi: conditionalDisclosureAbi,
    functionName: "approveDisclosure",
    args: [escrowId],
  });
}

/** Whether the disclosure has reached the authorising quorum. */
export async function isDisclosureAuthorizedOnChain(
  runner: DisclosureContractRunner,
  escrowId: Hex,
): Promise<boolean> {
  return (await runner.readContract({
    address: runner.address,
    abi: conditionalDisclosureAbi,
    functionName: "isDisclosureAuthorized",
    args: [escrowId],
  })) as boolean;
}

/** Erase an escrow (right-to-be-forgotten). */
export function eraseEscrowOnChain(
  runner: DisclosureContractRunner,
  escrowId: Hex,
): Promise<Hex> {
  return runner.writeContract({
    address: runner.address,
    abi: conditionalDisclosureAbi,
    functionName: "eraseEscrow",
    args: [escrowId],
  });
}
