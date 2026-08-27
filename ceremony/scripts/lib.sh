#!/usr/bin/env bash
#
# Shared configuration for the ZeroID Groth16 phase-2 trusted-setup ceremony.
# Sourced by every stage script. Portable across macOS (bash 3.2) and Linux.
#
set -euo pipefail

CEREMONY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$CEREMONY_DIR/.." && pwd)"
BUILD_DIR="$CEREMONY_DIR/build"          # compiled r1cs/wasm/sym per circuit
CONTRIB_DIR="$CEREMONY_DIR/contributions" # per-circuit .zkey chain (NOT committed; passed between contributors)
ARTIFACTS_DIR="$CEREMONY_DIR/artifacts"   # finalized vkeys + Solidity verifiers (committed)
PTAU="$CEREMONY_DIR/ptau/pot14.ptau"      # phase-1 (community Perpetual Powers of Tau)
TRANSCRIPT="$CEREMONY_DIR/TRANSCRIPT.md"

# Circuits in this ceremony: "<id>  <source .circom relative to repo root>".
# Keep in sync with package.json "circuits:compile" and circuits/manifest/*.
CIRCUITS="
eligibility_context_proof|circuits/eligibility/eligibility_context_proof.circom
age_proof|circuits/age/age_proof.circom
residency_proof|circuits/residency/residency_proof.circom
credit_tier_proof|circuits/credit/credit_tier_proof.circom
"

# snarkjs: prefer the repo-local install, fall back to npx.
snarkjs() {
  if [ -x "$REPO_DIR/node_modules/.bin/snarkjs" ]; then
    "$REPO_DIR/node_modules/.bin/snarkjs" "$@"
  else
    npx snarkjs "$@"
  fi
}

# circomlib include path (installed as a repo dependency).
CIRCOMLIB="$REPO_DIR/node_modules"

# Iterate circuits: `for_each_circuit id src; do ...`. Usage:
#   while IFS='|' read -r id src; do [ -n "$id" ] || continue; ... ; done <<EOF
#   $CIRCUITS
#   EOF
circuit_lines() { printf '%s\n' "$CIRCUITS" | sed '/^[[:space:]]*$/d'; }

# blake2b hash of a file (matches snarkjs contribution hashes) via snarkjs.
zkey_hash() { snarkjs zkey verify "$1" "$PTAU" "$2" 2>/dev/null | grep -iE 'hash' | head -1 || true; }

require() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: '$1' not found. $2" >&2; exit 1; }; }

log() { printf '\033[1;36m[ceremony]\033[0m %s\n' "$*"; }
