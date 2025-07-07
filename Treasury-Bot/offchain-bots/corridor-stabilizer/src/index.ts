// corridor_bot.ts
// Off-chain stabilizer for Guaso Coin to maintain price corridor [0.14 - 0.20 USDC]

import "dotenv/config";
import { Connection, PublicKey, Transaction, Keypair } from "@solana/web3.js";
import NodeCron from "node-cron";
import { JupiterClient, RouteInfo } from "@jup-ag/core";
import Orca, { Network, OrcaPoolConfig, Decimal } from "@orca-so/sdk";

// --- Configuration & Constants ---
const RPC_URL = process.env.RPC_URL!;
const KEYPAIR_PATH = process.env.KEYPAIR_PATH!;
const PROGRAM_ID = new PublicKey(process.env.CORRIDOR_PROGRAM_ID!);
const GC_MINT = new PublicKey(process.env.GC_MINT!);
const USDC_MINT = new PublicKey(process.env.USDC_MINT!);
const TREASURY_GC_VAULT = new PublicKey(process.env.TREASURY_GC_VAULT!);
const CORRIDOR_USDC_VAULT = new PublicKey(process.env.CORRIDOR_USDC_VAULT!);
const FEE_PCT = 0.01;  // 1% of treasury balances
const PRICE_UPPER = 0.20;
const PRICE_LOWER = 0.14;

// --- Clients & Connections ---
const connection = new Connection(RPC_URL, "confirmed");
const keypair = Keypair.fromSecretKey(Buffer.from(JSON.parse(require("fs").readFileSync(KEYPAIR_PATH, "utf-8"))));
const jupiter = new JupiterClient({ connection, cluster: "mainnet-beta" });
const orca = Orca.getInstance(Network.MAINNET);

// --- Helper Functions ---
async function getRaydiumPrice(): Promise<number> {
  // Fetch pool accounts, calculate price = usdc_reserve / gc_reserve
  // ... implementation using on-chain RPC
  throw new Error("getRaydiumPrice() not yet implemented");
}

async function getVaultBalance(mint: PublicKey, vault: PublicKey): Promise<number> {
  const accountInfo = await connection.getTokenAccountBalance(vault);
  return parseFloat(accountInfo.value.uiAmountString!);
}

async function jupiterSwap(inputMint: PublicKey, outputMint: PublicKey, amount: number): Promise<RouteInfo> {
  return (await jupiter.swap({
    inputMint,
    outputMint,
    amount,
    slippage: 0.5,
    showTransaction: false
  })).execute();
}

async function orcaSwap(inputMint: PublicKey, outputMint: PublicKey, amount: number): Promise<Decimal> {
  const pool = orca.getPool(inputMint.equals(GC_MINT) ? OrcaPoolConfig.GUASO_USDC : OrcaPoolConfig.GUASO_USDC);
  const inputToken = pool.getTokenA();
  const outputToken = pool.getTokenB();
  const quote = await pool.getQuote(inputToken, new Decimal(amount));
  return quote.execute();
}

async function emitOnChainLog(type: "Sell" | "Buy", qty: number, price: number) {
  // Build an instruction to your on-chain Corridor program that emits an event
  const tx = new Transaction().add(
    // TODO: create instruction via Anchor IDL to emit SwapOccurred{type, qty, price}
  );
  await connection.sendTransaction(tx, [keypair], { skipPreflight: true, preflightCommitment: "confirmed" });
}

// --- Main Rebalance Logic ---
async function rebalance() {
  const price = await getRaydiumPrice();
  const gcBal = await getVaultBalance(GC_MINT, TREASURY_GC_VAULT);
  const usdcBal = await getVaultBalance(USDC_MINT, CORRIDOR_USDC_VAULT);
  const gcAmount = Math.floor(gcBal * FEE_PCT);
  const usdcAmount = Number((usdcBal * FEE_PCT).toFixed(6));

  if (price > PRICE_UPPER && gcAmount > 0) {
    try {
      await jupiterSwap(GC_MINT, USDC_MINT, gcAmount);
    } catch {
      await orcaSwap(GC_MINT, USDC_MINT, gcAmount);
    }
    await emitOnChainLog("Sell", gcAmount, price);
    console.log(`Sold ${gcAmount} GC at price ${price}`);

  } else if (price < PRICE_LOWER && usdcAmount > 0) {
    try {
      await jupiterSwap(USDC_MINT, GC_MINT, usdcAmount);
    } catch {
      await orcaSwap(USDC_MINT, GC_MINT, usdcAmount);
    }
    await emitOnChainLog("Buy", usdcAmount, price);
    console.log(`Bought ${usdcAmount} GC at price ${price}`);

  } else {
    console.log(`Price ${price} within [${PRICE_LOWER}, ${PRICE_UPPER}], no action.`);
  }
}

// --- Scheduler: Align to Solana epoch ~6h intervals ---
NodeCron.schedule("0 */6 * * *", () => {
  console.log(`Epoch-aligned rebalance triggered at ${new Date().toISOString()}`);
  rebalance().catch(console.error);
});

console.log("Corridor bot started and scheduled every 6 hours.");
