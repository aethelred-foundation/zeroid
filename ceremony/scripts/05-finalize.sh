#!/usr/bin/env bash
#
# Stage 5 — finalize. Run ONCE by the coordinator AFTER the last contributor.
# Applies a public, unpredictable random beacon (closes the ceremony so no one
# can add a secret contribution afterwards), then exports the verification key
# and the Solidity verifier for each circuit into ceremony/artifacts/.
#
# The beacon MUST be a value fixed in the future and public (e.g. a Bitcoin
# block hash at an announced height, or an Ethereum block hash). Pass it in:
#   05-finalize.sh <beaconHashHex> [iterations=10]
#
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

BEACON="${1:-}"
ITER="${2:-10}"
[ -n "$BEACON" ] || { echo "Usage: $0 <beaconHashHex> [iterations]   (a public future value, e.g. a Bitcoin block hash)" >&2; exit 1; }
echo "$BEACON" | grep -qiE '^[0-9a-f]{16,64}$' || { echo "ERROR: beacon must be 16-64 hex chars." >&2; exit 1; }
mkdir -p "$ARTIFACTS_DIR"

while IFS='|' read -r id src; do
  [ -n "$id" ] || continue
  r1cs="$BUILD_DIR/$id/$(basename "${src%.circom}").r1cs"
  latest="$(ls "$CONTRIB_DIR"/${id}_[0-9][0-9][0-9][0-9].zkey 2>/dev/null | sort | tail -1 || true)"
  [ -f "$r1cs" ] && [ -n "$latest" ] || { echo "ERROR: $id missing r1cs or contributions." >&2; exit 1; }

  final="$CONTRIB_DIR/${id}_final.zkey"
  log "finalizing $id: beacon on $(basename "$latest") -> ${id}_final.zkey"
  snarkjs zkey beacon "$latest" "$final" "$BEACON" "$ITER" -n="final beacon"
  snarkjs zkey verify "$r1cs" "$PTAU" "$final"

  log "  exporting verification key + Solidity verifier for $id"
  snarkjs zkey export verificationkey "$final" "$ARTIFACTS_DIR/${id}_vkey.json"
  snarkjs zkey export solidityverifier "$final" "$ARTIFACTS_DIR/${id}_Verifier.sol"

  echo "| $(date -u +%Y-%m-%dT%H:%M:%SZ) | $id | FINAL | beacon | \`${id}_final.zkey\` | beacon=$BEACON iter=$ITER |" >> "$TRANSCRIPT"
done <<EOF
$(circuit_lines)
EOF

log "ceremony finalized. Artifacts (vkeys + Solidity verifiers) in $ARTIFACTS_DIR."
log "Deploy the verifier(s) / register the vkeys, and publish $TRANSCRIPT so anyone can audit."
