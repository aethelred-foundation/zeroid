#!/usr/bin/env bash
#
# Stage 4 — verify a contribution chain. ANYONE can run this against the r1cs +
# phase-1 ptau to confirm that every contribution is well-formed and that the
# final zkey descends from the published starting point. This is what makes the
# ceremony trustless: you don't have to trust contributors, you verify the math.
#
# Usage:  04-verify.sh [circuit_id]   (default: all circuits, latest zkey)
#
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ONLY="${1:-}"
rc=0

while IFS='|' read -r id src; do
  [ -n "$id" ] || continue
  [ -z "$ONLY" ] || [ "$ONLY" = "$id" ] || continue
  r1cs="$BUILD_DIR/$id/$(basename "${src%.circom}").r1cs"
  latest="$(ls "$CONTRIB_DIR"/${id}_[0-9][0-9][0-9][0-9].zkey 2>/dev/null | sort | tail -1 || true)"
  [ -f "$r1cs" ] && [ -n "$latest" ] || { echo "SKIP $id (missing r1cs or zkey)"; continue; }
  log "verifying $id -> $(basename "$latest")"
  if snarkjs zkey verify "$r1cs" "$PTAU" "$latest"; then
    log "  OK $id"
  else
    echo "  FAIL $id" >&2; rc=1
  fi
done <<EOF
$(circuit_lines)
EOF

[ $rc -eq 0 ] && log "all verified ✓" || echo "verification FAILED" >&2
exit $rc
