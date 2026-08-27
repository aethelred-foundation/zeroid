const requiredCryptoExports = [
  "configurePQCProvider",
  "getPQCProvider",
  "hasConfiguredPQCProvider",
  "toHex",
];

let cryptoModule;
try {
  cryptoModule = await import("@aethelred/sdk/crypto");
} catch (error) {
  throw new Error(
    "Unable to load the canonical @aethelred/sdk crypto runtime. Install and build the pinned SDK before building ZeroID.",
    { cause: error },
  );
}

const missingExports = requiredCryptoExports.filter(
  (exportName) => typeof cryptoModule[exportName] !== "function",
);

if (missingExports.length > 0) {
  throw new Error(
    `The installed @aethelred/sdk runtime is stale or incomplete; missing exports: ${missingExports.join(
      ", ",
    )}. Rebuild the canonical SDK package, reinstall ZeroID dependencies, and retry.`,
  );
}

console.log("Validated canonical @aethelred/sdk crypto runtime");
