// offchain-bots/subscribe-bot/src/refund_watcher.ts
// Watches for underpayments and expired subscriptions to trigger refunds and SBT revocations

import "dotenv/config";
import { Connection, PublicKey, Keypair, Transaction } from "@solana/web3.js";
import { AnchorProvider, Program, Idl, web3 } from "@project-serum/anchor";
import fs from "fs";

// --- Configuration & Constants ---
const RPC_URL = process.env.RPC_URL!;
const KEYPAIR_PATH = process.env.KEYPAIR_PATH!;
const SUBSCRIBE_PROGRAM_ID = new PublicKey(process.env.SUBSCRIBE_PROGRAM_ID!);
// 48h grace period in slots (~216_000 slots per day)
const SLOTS_PER_DAY = 216_000;
const GRACE_SLOTS = SLOTS_PER_DAY * 2;

// Load keypair
const secret = JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf-8"));
const keypair = Keypair.fromSecretKey(Buffer.from(secret));

// Setup provider & program
const connection = new Connection(RPC_URL, "confirmed");
const provider = new AnchorProvider(connection, new AnchorProvider.Wallet(keypair), {});
const idl = JSON.parse(fs.readFileSync(
  "../anchor-programs/subscribe/target/idl/subscribe.json", "utf-8"
)) as Idl;
const program = new Program(idl, SUBSCRIBE_PROGRAM_ID, provider);

// --- Watcher Functions ---

// 1. Handle underpayment refunds (on-chain logic covers refund, but catch failures)
async function handleRefunds() {
  // Subscribe to "SubscribeError::InsufficientAmount" events or failed txs
  connection.onLogs(
    SUBSCRIBE_PROGRAM_ID,
    async (logs, ctx) => {
      if (logs.err && logs.err.Custom) {
        // Assuming error code maps to InsufficientAmount
        console.log(`Detected failed subscribe tx: ${ctx.signature}`);
        // Fetch transaction, compute refund amount via on-chain state or logs
        // TODO: derive user, refund_amount from program logs/events
        // Construct and send refund tx (CPI to subscribe program)
      }
    },
    "confirmed"
  );
}

// 2. Handle expired subscriptions and revoke SBT after 48h grace
async function handleExpiry() {
  // Fetch all subscription accounts
  const subs = await program.account.subscription.all();
  const clock = await connection.getSlot();
  for (const { account, publicKey } of subs) {
    const expiry = account.expirySlot as unknown as number;
    if (clock > expiry + GRACE_SLOTS) {
      console.log(`Revoking SBT for subscription ${publicKey.toBase58()}`);
      try {
        const tx = await program.methods
          .revokeSbt()
          .accounts({ subscription: publicKey, authority: provider.wallet.publicKey })
          .rpc();
        console.log(`Revoked SBT tx: ${tx}`);
      } catch (err) {
        console.error(`Failed to revoke SBT: ${err}`);
      }
    }
  }
}

// --- Scheduler ---
async function startWatcher() {
  console.log("Starting refund & expiry watcher...");
  // Poll every hour
  setInterval(() => {
    handleExpiry().catch(console.error);
    // Refunds are event-driven
  }, 60 * 60 * 1000);
  await handleRefunds();
}

startWatcher();
