#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 07-register-vkeys.sh — register finalized verification keys on-chain in
# ZKCredentialVerifier (setVerificationKey, CIRCUIT_MANAGER_ROLE).
#
# Thin wrapper over register-vkeys.mjs (viem). Runs AFTER 05-finalize.sh; the
# vkeys it needs live in ceremony/artifacts/.
#
#   Dry-run (default — no chain, no key; validates mapping + prints calldata):
#     ./07-register-vkeys.sh
#
#   Broadcast (registers on-chain — needs the CIRCUIT_MANAGER_ROLE key):
#     RPC_URL=https://<node>:8545 \
#     ZKVERIFIER_ADDRESS=0x<ZKCredentialVerifier from deployments/<chainId>.json> \
#     CIRCUIT_MANAGER_PRIVATE_KEY=0x<key granted CIRCUIT_MANAGER_ROLE by GrantRoles.s.sol> \
#     CHAIN_ID=7332 \
#     ./07-register-vkeys.sh --broadcast
#
# viem is resolved from the repo-root node_modules (the frontend's).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"

if ! node -e "require.resolve('viem', { paths: ['$REPO_ROOT'] })" 2>/dev/null; then
  echo "ERROR: viem not found under $REPO_ROOT/node_modules — run 'npm ci' in the repo root first." >&2
  exit 1
fi

cd "$REPO_ROOT"
exec node "$HERE/register-vkeys.mjs" "$@"
