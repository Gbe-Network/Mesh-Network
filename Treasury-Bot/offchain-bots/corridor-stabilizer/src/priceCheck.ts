// File: offchain-bots/corridor-stabilizer/src/priceCheck.ts
// Fetches current GC/USDC price from Raydium via JupiterClient quote

import { Connection, PublicKey } from "@solana/web3.js";
import { JupiterClient } from "@jup-ag/core";

// Environment-driven constants
const RPC_URL = process.env.RPC_URL!;
const GC_MINT = new PublicKey(process.env.GC_MINT!);
const USDC_MINT = new PublicKey(process.env.USDC_MINT!);
const CLUSTER = process.env.CLUSTER || "mainnet-beta";

let jupiterClient: JupiterClient | null = null;

/**
 * Initializes JupiterClient singleton
 */
async function initJupiter(connection: Connection) {
  if (!jupiterClient) {
    jupiterClient = new JupiterClient({ connection, cluster: CLUSTER });
  }
  return jupiterClient;
}

/**
 * Returns mid-market GC price in USDC (ui units)
 */
export async function getRaydiumPrice(): Promise<number> {
  const connection = new Connection(RPC_URL, "confirmed");
  const jup = await initJupiter(connection);

  // Query a small notional amount for price quote
  const notional = 1 * 10 ** 6; // 1 GC in base units (6 decimals)
  const routes = await jup.getRoutes({
    inputMint: GC_MINT,
    outputMint: USDC_MINT,
    amount: notional,
    slippage: 0.1,      // 0.1% slippage tolerance
    forceFetch: true    // ensure fresh data
  });

  if (!routes || routes.routesInfos.length === 0) {
    throw new Error("No price route available for GC/USDC");
  }

  // Take best route (assumed Raydium primary)
  const best = routes.routesInfos[0];
  // outAmount is in base units of USDC (6 decimals)
  const price = best.outAmount / notional;
  return price;
}
