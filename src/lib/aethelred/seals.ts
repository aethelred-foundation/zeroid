/**
 * ZeroID — Aethelred Conformance Boundary: Digital Seals
 *
 * Chain-anchored evidence via the canonical `x/seal` module. A Digital Seal
 * binds a PoUW job's commitments (model/input/output), validator attestations,
 * optional TEE attestation, and zkML proof into a verifiable, exportable
 * record — the institutional audit trail for "what ran, where, and how it was
 * anchored on-chain".
 */

import type {
  CreateSealRequest,
  CreateSealResponse,
  DigitalSeal,
  VerifySealResponse,
} from "@aethelred/sdk";
import { getSealsModule } from "./client";

/** Create a Digital Seal anchoring a PoUW job's evidence (returns id + txHash). */
export async function createDigitalSeal(
  request: CreateSealRequest,
): Promise<CreateSealResponse> {
  return getSealsModule().create(request);
}

/** Verify a Digital Seal by id. */
export async function verifyDigitalSeal(
  sealId: string,
): Promise<VerifySealResponse> {
  return getSealsModule().verify(sealId);
}

/** Fetch a Digital Seal by id. */
export async function getDigitalSeal(sealId: string): Promise<DigitalSeal> {
  return getSealsModule().get(sealId);
}
