import * as dotenv from "dotenv";
dotenv.config();

import { Bot, Context } from "grammy";
import { JsonRpcProvider, Contract, BigNumber } from "ethers";

import stakeJson from "../artifacts/contracts/GbeRelayStake.sol/GbeRelayStake.json";
const stakeAbi: any = stakeJson.abi;

const { RPC_BASE, STAKE_ADDR, TG_TOKEN } = process.env as {
  RPC_BASE: string;
  STAKE_ADDR: string;
  TG_TOKEN: string;
};

if (!RPC_BASE || !STAKE_ADDR || !TG_TOKEN) {
  console.error("❌ Missing one of RPC_BASE, STAKE_ADDR, or TG_TOKEN in .env");
  process.exit(1);
}

const provider = new JsonRpcProvider(RPC_BASE);
const stake    = new Contract(STAKE_ADDR, stakeAbi, provider);
const bot      = new Bot<Context>(TG_TOKEN);


bot.command("start", (ctx: Context) =>
  ctx.reply(
    "Welcome to Gbe Mesh!\n" +
      "• /rates – staking parameters\n" +
      "• /status – your relay stats"
  )
);

/**
 * /rates
 */
bot.command("rates", (ctx: Context) =>
  ctx.reply("· Stake: 250 GC\n· Reward: 0.5 GC per GB")
);

/**
 * /status
 */
bot.command("status", async (ctx: Context) => {
  // TODO: map ctx.from?.id → Ethereum address via your database
  const userAddress = "<user-wallet-address>";

  try {
    const r = await stake.relays(userAddress);
    // r.since and r.bytesFwd come back as BigNumber
    if (r.since.eq(BigNumber.from(0))) {
      return ctx.reply("No relay registered.");
    }

    const sinceDate = new Date(r.since.toNumber() * 1000).toLocaleDateString("en-GB");
    const gbUsed    = Number(r.bytesFwd.toBigInt()) / 1e9;
    const gbText    = gbUsed.toFixed(2);

    return ctx.reply(`Since: ${sinceDate}\nData forwarded: ${gbText} GB`);
  } catch (err: any) {
    console.error("Error fetching relay status:", err);
    return ctx.reply("⚠️ Failed to fetch status, please try again later.");
  }
});

/**
 * Launch bot
 */
bot
  .start()
  .then(() => console.log("🤖 Telegram bot is up"))
  .catch((err: any) => {
    console.error("Failed to start bot:", err);
    process.exit(1);
  });
