#!/usr/bin/env bash
#
# Stage 1 — compile the circom circuits to r1cs/wasm/sym.
# Run once by the coordinator. Requires `circom` (the ZeroID repo already uses
# it in package.json "circuits:compile") and the `circomlib` dependency.
#
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require circom "Install circom 2.1.x (https://docs.circom.io/getting-started/installation/)."
[ -d "$CIRCOMLIB/circomlib/circuits" ] || { echo "ERROR: circomlib missing — run 'npm install' in $REPO_DIR" >&2; exit 1; }

mkdir -p "$BUILD_DIR"

while IFS='|' read -r id src; do
  [ -n "$id" ] || continue
  log "compiling $id ($src)"
  out="$BUILD_DIR/$id"
  mkdir -p "$out"
  circom "$REPO_DIR/$src" --r1cs --wasm --sym -l "$CIRCOMLIB" -o "$out"
  log "  -> $out/$(basename "${src%.circom}").r1cs"
  snarkjs r1cs info "$out/$(basename "${src%.circom}").r1cs" | sed 's/^/    /'
done <<EOF
$(circuit_lines)
EOF

log "compile complete. r1cs constraint counts above determine the required ptau power."
