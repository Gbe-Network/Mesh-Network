import * as dotenv from "dotenv";
dotenv.config();

import { CronJob } from "cron";
import fetch from "node-fetch";
import { JsonRpcProvider, Wallet, Contract } from "ethers";
import stakeJson from "../artifacts/contracts/GbeRelayStake.sol/GbeRelayStake.json";

const { RPC_BASE, ORACLE_PRIV, STAKE_ADDR, METRICS_API } = process.env as {
  RPC_BASE: string;
  ORACLE_PRIV: string;
  STAKE_ADDR: string;
  METRICS_API: string;
};

if (!RPC_BASE || !ORACLE_PRIV || !STAKE_ADDR || !METRICS_API) {
  console.error("❌ Missing one of RPC_BASE, ORACLE_PRIV, STAKE_ADDR, METRICS_API");
  process.exit(1);
}

const provider = new JsonRpcProvider(RPC_BASE);
const wallet = new Wallet(ORACLE_PRIV, provider);
const stake = new Contract(STAKE_ADDR, stakeJson.abi as any, wallet);

// Run every 15 minutes
new CronJob("*/15 * * * *", async () => {
  try {
    const stats: { addr: string; bytes: string }[] = await fetch(METRICS_API).then((r) => r.json());
    for (const { addr, bytes } of stats) {
      const tx1 = await stake.reportTraffic(addr, bytes);
      const tx2 = await stake.heartbeat(addr);
      await Promise.all([tx1.wait(), tx2.wait()]);
    }
    console.log("✅ Oracle push at", new Date().toISOString());
  } catch (err: unknown) {
    console.error("❌ Oracle error:", err);
  }
}).start();
