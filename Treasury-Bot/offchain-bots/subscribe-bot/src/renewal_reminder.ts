// File: offchain-bots/subscribe-bot/src/renewal_reminder.ts
// Watches subscriptions and sends renewal prompts 30 days before expiry

import "dotenv/config";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { AnchorProvider, Program, Idl } from "@project-serum/anchor";
import fs from "fs";
import TelegramBot from "node-telegram-bot-api";

// --- Configuration & Constants ---
const RPC_URL = process.env.RPC_URL!;
const KEYPAIR_PATH = process.env.KEYPAIR_PATH!;
const SUBSCRIBE_PROGRAM_ID = new PublicKey(process.env.SUBSCRIBE_PROGRAM_ID!);
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
// 30 days in slots (~216_000 slots/day)
const SLOTS_PER_DAY = 216_000;
const REMINDER_SLOTS = SLOTS_PER_DAY * 30;

// Load Solana keypair
const secret = JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf-8"));
const keypair = Keypair.fromSecretKey(Buffer.from(secret));

// Setup provider, program, and Telegram bot
const connection = new Connection(RPC_URL, "confirmed");
const provider = new AnchorProvider(connection, new AnchorProvider.Wallet(keypair), {});
const idl = JSON.parse(fs.readFileSync(
  "../anchor-programs/subscribe/target/idl/subscribe.json",
  "utf-8"
)) as Idl;
const program = new Program(idl, SUBSCRIBE_PROGRAM_ID, provider);
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

// In-memory set to avoid duplicate reminders
const reminded = new Set<string>();

// Fetch all subscriptions and send reminders
export async function sendRenewalReminders() {
  console.log("Checking for upcoming renewals...");
  const subs = await program.account.subscription.all();
  const slot = await connection.getSlot();

  for (const { publicKey, account } of subs) {
    const expiry = (account as any).expirySlot as number;
    const userPubkey = (account as any).user as PublicKey;
    const slotsUntilExpiry = expiry - slot;
    // If within 30 days and not yet reminded
    if (slotsUntilExpiry <= REMINDER_SLOTS && slotsUntilExpiry > 0) {
      const key = `${publicKey.toBase58()}`;
      if (!reminded.has(key)) {
        // send prompt via Telegram to user (must map wallet->chat ID)
        // TODO: implement wallet-to-Telegram mapping lookup
        const chatId = process.env.USER_CHAT_ID_MAP?.split(",").find(entry => entry.startsWith(userPubkey.toBase58()))?.split(":")[1];
        if (chatId) {
          bot.sendMessage(chatId, `📢 Your Guaso subscription expires in ~30 days. Please renew by sending 12 GC.`);
          console.log(`Sent renewal reminder to ${userPubkey.toBase58()}`);
          reminded.add(key);
        } else {
          console.warn(`No chat mapping for user ${userPubkey.toBase58()}`);
        }
      }
    }
  }
}
