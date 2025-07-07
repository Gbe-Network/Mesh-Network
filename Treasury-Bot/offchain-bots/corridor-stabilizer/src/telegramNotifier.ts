// File: offchain-bots/corridor-stabilizer/src/telegramNotifier.ts
// Listens for SwapOccurred events on-chain and notifies a Telegram chat

import "dotenv/config";
import { Connection, PublicKey, Commitment } from "@solana/web3.js";
import { EventCoder } from "@project-serum/borsh";
import { Telegraf } from "telegraf";

const RPC_URL = process.env.RPC_URL!;
const PROGRAM_ID = new PublicKey(process.env.CORRIDOR_PROGRAM_ID!);
const COMMITMENT = "confirmed" as Commitment;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID!;

// Anchor IDL excerpt for SwapOccurred event
const CORRIDOR_IDL = {
  events: [
    {
      name: "SwapOccurred",
      fields: [
        { name: "swapType", type: "string", index: false },
        { name: "qty", type: "u64", index: false },
        { name: "price", type: "u64", index: false }
      ]
    }
  ]
};

const connection = new Connection(RPC_URL, COMMITMENT);
const bot = new Telegraf(TOKEN);
const coder = new EventCoder(CORRIDOR_IDL);

export function startTelegramNotifier() {
  console.log("Starting Corridor Telegram Notifier...");
  connection.onLogs(PROGRAM_ID, async (logInfo) => {
    try {
      const parsed = coder.parse(logInfo.logs.join("\n"));
      if (parsed?.event.name === "SwapOccurred") {
        const { swapType, qty, price } = parsed.event.data;
        const message = `🔄 Corridor ${swapType}: qty=${qty.toString()} at price=${price.toString()}`;
        await bot.telegram.sendMessage(CHAT_ID, message);
        console.log("Sent corridor swap notification:", message);
      }
    } catch (err) {
      // ignore non-event logs
    }
  });
}
