#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 06-deploy-artifacts.sh — distribute finalized ceremony artifacts to their
# runtime consumers.
#
# Run AFTER 05-finalize.sh. Takes the finalized per-circuit output
#   - proving key : contributions/<circuit>_final.zkey
#   - witness wasm: build/<circuit>/<circuit>_js/<circuit>.wasm
#   - r1cs / sym  : build/<circuit>/<circuit>.{r1cs,sym}
#   - vkey        : artifacts/<circuit>_vkey.json
# and lands it where each consumer expects to find it:
#
#   1. FRONTEND  public/circuits/<dir>/…  — browser-side snarkjs proof generation
#      (paths per src/config/constants.ts: <dir>/<circuit>_js/<circuit>.wasm,
#       <dir>/<circuit>_final.zkey, <dir>/verification_key.json)
#
#   2. BACKEND   build/circuits/eligibility_context_v1/…  — the flagship
#      eligibility circuit only, at the paths its manifest
#      (circuits/manifest/eligibility_v1.json) declares. Landing these flips the
#      API's `/ready` circuitArtifacts check from `degraded` to `ok`.
#
# On-chain verification-key registration is a separate, signed step — see
# 07-register-vkeys.sh (it consumes the vkeys this script deploys).
#
# The deployed binaries are ceremony OUTPUT, not source: they are gitignored and
# re-materialised by running this script against a finalized ceremony. This
# script writes a deployment-manifest.json (sha256 of every deployed file) so a
# deployment can be tied back to the ceremony TRANSCRIPT.md.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CEREMONY_DIR="$(cd "$HERE/.." && pwd)"
REPO_ROOT="$(cd "$CEREMONY_DIR/.." && pwd)"
source "$HERE/lib.sh"

BUILD_DIR="$CEREMONY_DIR/build"
CONTRIB_DIR="$CEREMONY_DIR/contributions"
VKEY_DIR="$CEREMONY_DIR/artifacts"

FRONTEND_CIRCUITS="$REPO_ROOT/public/circuits"
BACKEND_ELIGIBILITY="$REPO_ROOT/build/circuits/eligibility_context_v1"

# circuit-name  →  frontend public/circuits subdirectory ("-" = not frontend-facing).
# Names must match the compiled circuit basenames (01-compile.sh) and the frontend
# CIRCUIT_IDS config. eligibility_context_proof is the backend/on-chain policy
# circuit and has no browser flow, so its frontend dir is "-".
CIRCUITS=(
  "eligibility_context_proof:-"
  "age_proof:age"
  "residency_proof:residency"
  "credit_tier_proof:credit"
)

sha() { shasum -a 256 "$1" | awk '{print $1}'; }
err() { printf '\033[1;31m[ceremony]\033[0m %s\n' "$*" >&2; }

# Note: lib.sh defines a require() that checks for a command; this checks for a
# file, so it is named distinctly to avoid shadowing it.
require_file() {
  if [[ ! -f "$1" ]]; then
    err "missing ceremony artifact: $1"
    err "run 05-finalize.sh first (and 01-compile.sh for the wasm/r1cs)."
    exit 1
  fi
}

MANIFEST="$VKEY_DIR/deployment-manifest.json"
manifest_rows=()
add_row() { manifest_rows+=("    {\"target\":\"$1\",\"path\":\"$2\",\"sha256\":\"$3\"}"); }

log "deploying finalized ceremony artifacts"
log "  repo root : $REPO_ROOT"
log "  frontend  : $FRONTEND_CIRCUITS"
log "  backend   : $BACKEND_ELIGIBILITY"

for entry in "${CIRCUITS[@]}"; do
  circuit="${entry%%:*}"
  fedir="${entry##*:}"

  wasm_src="$BUILD_DIR/$circuit/${circuit}_js/${circuit}.wasm"
  zkey_src="$CONTRIB_DIR/${circuit}_final.zkey"
  vkey_src="$VKEY_DIR/${circuit}_vkey.json"
  require_file "$wasm_src"; require_file "$zkey_src"; require_file "$vkey_src"

  # ── 1. Frontend (browser proving) ────────────────────────────────────────
  if [[ "$fedir" != "-" ]]; then
    dst="$FRONTEND_CIRCUITS/$fedir"
    mkdir -p "$dst/${circuit}_js"
    cp "$wasm_src" "$dst/${circuit}_js/${circuit}.wasm"
    cp "$zkey_src" "$dst/${circuit}_final.zkey"
    cp "$vkey_src" "$dst/verification_key.json"
    log "  frontend  ✓ $fedir  (wasm + final.zkey + verification_key.json)"
    add_row "frontend/$fedir" "public/circuits/$fedir/${circuit}_final.zkey" "$(sha "$zkey_src")"
  fi

  # ── 2. Backend flagship (eligibility only — flips /ready to ok) ───────────
  if [[ "$circuit" == "eligibility_context_proof" ]]; then
    r1cs_src="$BUILD_DIR/$circuit/${circuit}.r1cs"
    sym_src="$BUILD_DIR/$circuit/${circuit}.sym"
    require_file "$r1cs_src"; require_file "$sym_src"
    mkdir -p "$BACKEND_ELIGIBILITY/${circuit}_js"
    cp "$r1cs_src" "$BACKEND_ELIGIBILITY/${circuit}.r1cs"
    cp "$sym_src"  "$BACKEND_ELIGIBILITY/${circuit}.sym"
    cp "$wasm_src" "$BACKEND_ELIGIBILITY/${circuit}_js/${circuit}.wasm"
    cp "$zkey_src" "$BACKEND_ELIGIBILITY/${circuit}_final.zkey"
    cp "$vkey_src" "$BACKEND_ELIGIBILITY/verification_key.json"
    log "  backend   ✓ eligibility_context_v1  (r1cs + sym + wasm + final.zkey + verification_key.json)"
    add_row "backend/eligibility" "build/circuits/eligibility_context_v1/verification_key.json" "$(sha "$vkey_src")"
  fi
done

# ── deployment manifest (traceability back to TRANSCRIPT.md) ────────────────
{
  echo "{"
  echo "  \"schema\": \"zeroid.artifact_deployment.v1\","
  echo "  \"deployedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"repoRoot\": \"$REPO_ROOT\","
  echo "  \"artifacts\": ["
  ( IFS=$',\n'; echo "${manifest_rows[*]}" )
  echo "  ]"
  echo "}"
} > "$MANIFEST"

log "wrote deployment manifest → ${MANIFEST#$REPO_ROOT/}"
log "done. Next: 07-register-vkeys.sh (on-chain vkey registration)."
log "Verify backend readiness:  (cd backend && curl -s localhost:4003/ready | jq .checks.circuitArtifacts)  → \"ok\""
