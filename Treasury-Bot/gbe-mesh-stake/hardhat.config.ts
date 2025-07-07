import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const { PRIVKEY, RPC_SEPOLIA, RPC_BASE, ETHERSCAN_KEY } = process.env as {
  PRIVKEY: string;
  RPC_SEPOLIA: string;
  RPC_BASE: string;
  ETHERSCAN_KEY: string;
};

if (!PRIVKEY || !RPC_SEPOLIA || !RPC_BASE) {
  console.error("❌ Missing env vars: PRIVKEY, RPC_SEPOLIA, or RPC_BASE");
  process.exit(1);
}

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  defaultNetwork: "hardhat",
  networks: {
    sepolia: { url: RPC_SEPOLIA, accounts: [PRIVKEY] },
    base:    { url: RPC_BASE,    accounts: [PRIVKEY] }
  },
  etherscan: {
    apiKey: ETHERSCAN_KEY || ""
  }
};

export default config;
