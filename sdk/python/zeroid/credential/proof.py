"""Credential proof helpers shared by issuer and verifier."""

from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any, Sequence

from zeroid.crypto.hashing import compute_merkle_root, keccak256


def compute_credential_subject_merkle_root(
    credential_subject: dict[str, Any],
) -> bytes:
    """Compute the deterministic subject root used in credential proofs."""
    leaves = []
    for key, value in sorted(credential_subject.items()):
        leaf_data = json.dumps({key: value}, sort_keys=True).encode("utf-8")
        leaves.append(keccak256(leaf_data))
    return compute_merkle_root(leaves) if leaves else b""


def build_credential_proof_payload(
    *,
    credential_id: str,
    credential_types: Sequence[str],
    issuer: str,
    issuance_date: str,
    expiration_date: str,
    credential_schema: str,
    subject_merkle_root: str,
) -> bytes:
    """Build the canonical payload covered by the credential proof."""
    payload = {
        "credentialSchema": credential_schema,
        "expirationDate": expiration_date,
        "id": credential_id,
        "issuanceDate": issuance_date,
        "issuer": issuer,
        "subjectMerkleRoot": subject_merkle_root,
        "type": list(credential_types),
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )


def compute_credential_proof_value(signing_key: str, payload: bytes) -> str:
    """Compute the proof value for the configured issuer key."""
    return hmac.new(
        signing_key.encode("utf-8"),
        payload,
        hashlib.sha3_256,
    ).hexdigest()
