import "dotenv/config";
import { Connection, PublicKey } from "@solana/web3.js";
import TelegramBot from "node-telegram-bot-api";

const RPC_URL = process.env.RPC_URL!;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID!;
const SUBSCRIBE_PROGRAM_ID = new PublicKey(process.env.SUBSCRIBE_PROGRAM_ID!);
const CORRIDOR_PROGRAM_ID = new PublicKey(process.env.CORRIDOR_PROGRAM_ID!);

const connection = new Connection(RPC_URL, "confirmed");
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.on("polling_error", console.error);

async function startNotifier() {
  console.log("Starting Public Channel Notifier...");

  // Listen for Subscribe events and errors
  connection.onLogs(
    SUBSCRIBE_PROGRAM_ID,
    (logInfo) => {
      logInfo.logs.forEach((line) => {
        if (line.includes("Event: Subscribed")) {
          bot.sendMessage(CHANNEL_ID, `✅ New subscription: ${line}`);
        } else if (line.includes("Refunded")) {
          bot.sendMessage(CHANNEL_ID, `💸 Refund processed: ${line}`);
        } else if (line.includes("Revoked")) {
          bot.sendMessage(CHANNEL_ID, `⏳ Subscription expired: ${line}`);
        }
      });
    },
    "confirmed"
  );

  // Listen for Corridor swap events
  connection.onLogs(
    CORRIDOR_PROGRAM_ID,
    (logInfo) => {
      logInfo.logs.forEach((line) => {
        if (line.includes("SwapOccurred")) {
          bot.sendMessage(CHANNEL_ID, `🔄 Corridor swap: ${line}`);
        }
      });
    },
    "confirmed"
  );
}

startNotifier().catch(console.error);