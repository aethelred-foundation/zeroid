#!/usr/bin/env bash
#
# Stage 2 — coordinator initialisation. Run ONCE by the coordinator after
# compiling (stage 1). Produces the initial `<circuit>_0000.zkey` for each
# circuit from its r1cs + the phase-1 ptau. This step is deterministic and
# contains NO secret entropy — it is the starting point every contributor
# builds on. Verify it (stage 4) before contributing.
#
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ -f "$PTAU" ] || { echo "ERROR: phase-1 ptau not found at $PTAU. See ceremony/README.md (Powers of Tau)." >&2; exit 1; }
mkdir -p "$CONTRIB_DIR"

while IFS='|' read -r id src; do
  [ -n "$id" ] || continue
  r1cs="$BUILD_DIR/$id/$(basename "${src%.circom}").r1cs"
  [ -f "$r1cs" ] || { echo "ERROR: $r1cs missing — run 01-compile.sh first." >&2; exit 1; }
  log "coordinator init: $id  (0000.zkey)"
  snarkjs groth16 setup "$r1cs" "$PTAU" "$CONTRIB_DIR/${id}_0000.zkey"
  # Record the initial parameters hash so contributors can confirm a common start.
  snarkjs zkey verify "$r1cs" "$PTAU" "$CONTRIB_DIR/${id}_0000.zkey" | sed 's/^/    /' | tail -4
done <<EOF
$(circuit_lines)
EOF

log "coordinator init complete. Contributors start from the *_0000.zkey files."
log "Next: 03-contribute.sh <your-handle>  (the first contributor turns 0000 -> 0001)."
