/**
 * ZeroID — Aethelred Conformance Boundary: conditional disclosure orchestrator
 *
 * One-call end-to-end flow tying the off-chain key-split escrow to the on-chain
 * compliance quorum: encrypt + Shamir-split the payload, then anchor only its
 * commitment on-chain. The returned `escrow.shares` are distributed to the
 * quorum; nothing but the commitment + nullifier touches the ledger.
 */

import {
  createDisclosureEscrow,
  type DisclosurePolicy,
  type DisclosureEscrow,
} from "./disclosure";
import {
  commitmentToBytes32,
  registerEscrowOnChain,
  type DisclosureContractRunner,
} from "./disclosure-contract";
import type { Hex } from "viem";

export interface IdentityDisclosureResult {
  escrowId: Hex;
  /** Off-chain escrow material; distribute `shares` to the quorum, keep ciphertext/iv. */
  escrow: DisclosureEscrow;
  /** On-chain registration transaction hash. */
  txHash: Hex;
}

/** Encrypt + key-split a disclosure payload off-chain, then anchor its commitment on-chain. */
export async function discloseIdentityPath(
  runner: DisclosureContractRunner,
  escrowId: Hex,
  subjectNullifier: Hex,
  payload: Uint8Array,
  policy: DisclosurePolicy,
): Promise<IdentityDisclosureResult> {
  const escrow = await createDisclosureEscrow(payload, policy);
  const txHash = await registerEscrowOnChain(runner, {
    escrowId,
    commitment: commitmentToBytes32(escrow.commitment),
    subjectNullifier,
  });
  return { escrowId, escrow, txHash };
}
