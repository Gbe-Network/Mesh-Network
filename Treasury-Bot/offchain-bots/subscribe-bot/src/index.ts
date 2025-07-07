// File: offchain-bots/subscribe-bot/src/index.ts
// Entry point: listens for Subscribed events and notifies users via Telegram

import { Connection, PublicKey, Commitment } from "@solana/web3.js";
import { EventCoder } from "@project-serum/borsh";
import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import winston from "winston";

dotenv.config();
const logger = winston.createLogger({ transports: [new winston.transports.Console()] });
const conn = new Connection(process.env.RPC_URL!, "confirmed" as Commitment);
const bot = new Telegraf(process.env.TELEGRAM_TOKEN!);
const PROGRAM_ID = new PublicKey(process.env.SUBSCRIBE_PROGRAM!);

// Anchor IDL excerpt for event decoding
const SUBSCRIBE_IDL = {
  events: [
    {
      name: "Subscribed",
      fields: [
        { name: "user", type: "publicKey", index: false },
        { name: "expiry_slot", type: "u64", index: false }
      ]
    }
  ]
};

const coder = new EventCoder(SUBSCRIBE_IDL);

(async () => {
  logger.info("Subscribe-bot listening for Subscribed events...");

  conn.onLogs(PROGRAM_ID, async (log) => {
    for (const line of log.logs) {
      if (line.startsWith("Program log:")) {
        try {
          const parsed = coder.parse(log.logs.join("\n"));
          if (parsed?.event.name === "Subscribed") {
            const { user, expiry_slot } = parsed.event.data;
            await bot.telegram.sendMessage(
              user.toBase58(),
              `🎫 Your GC subscription is active until slot ${expiry_slot}`
            );
            logger.info(`Notified ${user.toBase58()} of new subscription.`);
          }
        } catch {
          // ignore non-event logs
        }
      }
    }
  });
})();
