import assert from "node:assert/strict";
import test from "node:test";

import {
  renderDeploymentEnv,
  updateEnvironmentText,
  validateDeploymentManifest,
} from "./apply-deployment-manifest.mjs";

const manifest = {
  chainId: 7332,
  identityRegistry: "0x1111111111111111111111111111111111111111",
  zkVerifier: "0x2222222222222222222222222222222222222222",
  accumulatorRevocation: "0x3333333333333333333333333333333333333333",
  governanceModule: "0x4444444444444444444444444444444444444444",
  credentialRegistry: "0x5555555555555555555555555555555555555555",
  selectiveDisclosure: "0x6666666666666666666666666666666666666666",
};

test("validates the six-contract public-testnet manifest", () => {
  const result = validateDeploymentManifest(manifest, 7332);
  assert.equal(result.chainId, 7332);
  assert.equal(
    result.addresses.NEXT_PUBLIC_CREDENTIAL_REGISTRY_ADDRESS,
    manifest.credentialRegistry,
  );
});

test("rejects a manifest for another chain", () => {
  assert.throws(
    () => validateDeploymentManifest(manifest, 1),
    /does not match expected chain ID/,
  );
});

test("rejects missing, zero, and duplicate addresses", () => {
  assert.throws(
    () => validateDeploymentManifest({ ...manifest, zkVerifier: "" }, 7332),
    /manifest.zkVerifier/,
  );
  assert.throws(
    () =>
      validateDeploymentManifest(
        { ...manifest, zkVerifier: `0x${"0".repeat(40)}` },
        7332,
      ),
    /zero address/,
  );
  assert.throws(
    () =>
      validateDeploymentManifest(
        { ...manifest, zkVerifier: manifest.identityRegistry },
        7332,
      ),
    /duplicate/,
  );
});

test("replaces stale address lines without duplicating managed values", () => {
  const existing = [
    "NEXT_PUBLIC_CHAIN_ENV=testnet",
    "NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "UNRELATED_VALUE=preserved",
    "",
  ].join("\n");
  const updated = updateEnvironmentText(existing, manifest, 7332);

  assert.match(updated, /NEXT_PUBLIC_CHAIN_ENV=testnet/);
  assert.match(updated, /UNRELATED_VALUE=preserved/);
  assert.doesNotMatch(updated, /0xaaaaaaaa/);
  assert.equal(
    updated.match(/NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS=/g)?.length,
    1,
  );
  assert.equal(renderDeploymentEnv(manifest, 7332).split("\n").length, 10);
});
