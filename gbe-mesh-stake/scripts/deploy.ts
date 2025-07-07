import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

const { GC_ADDR, ORACLE_ADDR } = process.env as {
  GC_ADDR: string;
  ORACLE_ADDR: string;
};

if (!GC_ADDR || !ORACLE_ADDR) {
  console.error("❌ Missing env vars: GC_ADDR or ORACLE_ADDR");
  process.exit(1);
}

async function main() {
  const Stake = await ethers.deployContract("GbeRelayStake", [GC_ADDR, ORACLE_ADDR]);
  await Stake.waitForDeployment();
  console.log("✅ GbeRelayStake deployed at:", await Stake.getAddress());
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
