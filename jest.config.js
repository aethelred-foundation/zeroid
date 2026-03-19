const nextJest = require("next/jest");

const createJestConfig = nextJest({ dir: "./" });

/** @type {import('jest').Config} */
const config = {
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/src/mocks/setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@/components/(.*)$": "<rootDir>/src/components/$1",
    "^@/lib/(.*)$": "<rootDir>/src/lib/$1",
    "^@/hooks/(.*)$": "<rootDir>/src/hooks/$1",
    "^@/types/(.*)$": "<rootDir>/src/types/$1",
    "^@/config/(.*)$": "<rootDir>/src/config/$1",
    "^@/contexts/(.*)$": "<rootDir>/src/contexts/$1",
    "\\.wasm$": "<rootDir>/src/mocks/wasm.ts",
  },
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/types/**",
    "!src/mocks/**",
    "!src/config/abis.ts",
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 85,
      statements: 85,
    },
  },
  testPathIgnorePatterns: [
    "<rootDir>/node_modules/",
    "<rootDir>/.next/",
    "<rootDir>/lib/",
    "<rootDir>/contracts/",
    "<rootDir>/test/",
    "<rootDir>/artifacts/",
    "<rootDir>/cache/",
    "<rootDir>/circuits/",
    "<rootDir>/build/",
    "<rootDir>/backend/",
    "<rootDir>/crates/",
    "<rootDir>/sdk/",
  ],
  transformIgnorePatterns: [
    "/node_modules/(?!(snarkjs|circomlib|@rainbow-me|@wagmi|wagmi|viem|@tanstack)/)",
  ],
  reporters: ["default", "jest-junit"],
};

const baseConfig = createJestConfig(config);

// next/jest overrides transformIgnorePatterns — we must override it back
module.exports = async () => {
  const resolved = await baseConfig();
  resolved.transformIgnorePatterns = [
    "node_modules/(?!(snarkjs|circomlib|@rainbow-me|@wagmi|wagmi|viem|@tanstack)/)",
  ];
  return resolved;
};
