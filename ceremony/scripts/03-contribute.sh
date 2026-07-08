#!/usr/bin/env bash
#
# Stage 3 — a CONTRIBUTOR adds their entropy. This is the step that makes the
# ceremony multi-party: each independent participant folds in randomness that
# only they know and then destroys it. The setup is secure as long as AT LEAST
# ONE contributor is honest and independent.
#
# Usage:  03-contribute.sh <your-handle>
#   e.g.  03-contribute.sh alice-us-team
#
# You receive the previous contributor's *_NNNN.zkey files (in ceremony/
# contributions/), run this, and pass your *_MMMM.zkey files to the next person.
# snarkjs will prompt you to type random text — bang on the keyboard. Do NOT
# reuse entropy, do NOT script it, and do NOT keep a copy of what you typed.
#
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

HANDLE="${1:-}"
[ -n "$HANDLE" ] || { echo "Usage: $0 <your-handle>   (e.g. alice-us-team)" >&2; exit 1; }
echo "$HANDLE" | grep -qE '^[a-zA-Z0-9._-]+$' || { echo "ERROR: handle must be [a-zA-Z0-9._-]" >&2; exit 1; }

while IFS='|' read -r id src; do
  [ -n "$id" ] || continue
  # Find the latest contribution index N for this circuit.
  latest="$(ls "$CONTRIB_DIR"/${id}_[0-9][0-9][0-9][0-9].zkey 2>/dev/null | sort | tail -1 || true)"
  [ -n "$latest" ] || { echo "ERROR: no starting zkey for $id — coordinator must run 02 first, or fetch the latest contributions." >&2; exit 1; }
  n="$(basename "$latest" | sed -E "s/^${id}_0*([0-9]+)\.zkey$/\1/")"
  next="$(printf '%04d' "$((n + 1))")"
  out="$CONTRIB_DIR/${id}_${next}.zkey"
  log "contributing to $id: $(basename "$latest") -> $(basename "$out")   [$HANDLE]"
  # Two entropy paths: humans type keystrokes at the interactive prompt; an
  # automated contributor sets CEREMONY_ENTROPY to fresh OS-CSPRNG randomness
  # (e.g. CEREMONY_ENTROPY=$(openssl rand -hex 64)). Both are real entropy; in
  # both cases it must be unique per contribution and never retained.
  if [ -n "${CEREMONY_ENTROPY:-}" ]; then
    snarkjs zkey contribute "$latest" "$out" --name="$HANDLE" -e="$CEREMONY_ENTROPY" -v
  else
    snarkjs zkey contribute "$latest" "$out" --name="$HANDLE" -v
  fi
  # Re-derive the blake2b contribution hash cleanly (strip ANSI, take the last
  # contribution block's four 8-hex-group lines) for the public transcript.
  hash="$(snarkjs zkey verify "$BUILD_DIR/$id/$(basename "${src%.circom}").r1cs" "$PTAU" "$out" 2>/dev/null \
    | sed -E 's/\x1b\[[0-9;]*m//g' \
    | awk '/contribution #[0-9]+ /{buf="";grab=4;next} grab>0{gsub(/[^0-9a-fA-F]/,"");buf=buf $0;grab--;if(grab==0)last=buf} END{print last}')"
  log "  recorded: $out  (hash ${hash:0:16}…)"
  printf '| %s | `%s` | %s | %s | `%s` |\n' \
    "$(date -u +%Y-%m-%dT%H:%MZ)" "$id" "$((10#$next))" "$HANDLE" "${hash:-see-snarkjs-output}" >> "$TRANSCRIPT"
done <<EOF
$(circuit_lines)
EOF

log "contribution complete. Append is in $TRANSCRIPT."
log "Send your *_${next}.zkey files to the NEXT contributor (or the coordinator to finalize)."
log "Then DELETE any note of the randomness you typed."
