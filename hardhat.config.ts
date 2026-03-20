import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig & { gasReporter?: any } = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test/hardhat",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {
      chainId: 31337,
    } as any,
    aethelredTestnet: {
      url: process.env.TESTNET_RPC_URL ?? "https://rpc.testnet.aethelred.io",
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
      chainId: 7001,
    } as any,
    aethelredMainnet: {
      url: process.env.MAINNET_RPC_URL ?? "https://rpc.aethelred.io",
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
      chainId: 7000,
    } as any,
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
  },
};

export default config;
