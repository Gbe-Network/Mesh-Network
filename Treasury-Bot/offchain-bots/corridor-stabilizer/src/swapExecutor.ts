// File: offchain-bots/corridor-stabilizer/src/swapExecutor.ts
// Executes swaps via Jupiter with an Orca fallback

import { Connection, PublicKey } from "@solana/web3.js";
import { JupiterClient, RouteInfo, SwapResult } from "@jup-ag/core";
import Orca, { Network, OrcaPoolConfig, OrcaPool } from "@orca-so/sdk";

// Environment-configured values
const RPC_URL = process.env.RPC_URL!;
const CLUSTER = process.env.CLUSTER || "mainnet-beta";
const connection = new Connection(RPC_URL, "confirmed");
let jupiterClient: JupiterClient | null = null;

async function initJupiter() {
  if (!jupiterClient) {
    jupiterClient = new JupiterClient({ connection, cluster: CLUSTER });
  }
  return jupiterClient;
}

/**
 * Attempts to swap `amount` of `inputMint` to `outputMint` via Jupiter,
 * falling back to Orca if Jupiter fails.
 * Returns the amount received in output mint's base units.
 */
export async function executeSwap(
  inputMint: PublicKey,
  outputMint: PublicKey,
  amount: number
): Promise<number> {
  const jup = await initJupiter();
  try {
    const swapResult = await jup
      .swap({ inputMint, outputMint, amount, slippage: 0.5, forceFetch: true })
      .execute();
    return parseFloat(swapResult.outAmount.toString());
  } catch (jupErr) {
    console.warn("Jupiter swap failed, falling back to Orca", jupErr);
    const orca = Orca.getInstance(Network.MAINNET);
    // Determine appropriate pool config
    const poolConfig = OrcaPoolConfig.GUASO_USDC;
    const pool: OrcaPool = orca.getPool(poolConfig);
    const inputToken = pool.getTokenA().mint.equals(inputMint)
      ? pool.getTokenA()
      : pool.getTokenB();
    // Execute swap quote
    const quote = await pool.getQuote(inputToken, amount);
    const swapTx = await quote.execute();
    return parseFloat(swapTx.toString());
  }
}
