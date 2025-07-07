// File: api-indexer/src/eventListener.ts
import { Connection, PublicKey, Commitment } from '@solana/web3.js';
import { EventCoder } from '@project-serum/borsh';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();
const RPC_URL = process.env.RPC_URL!;
const COMMITMENT = 'confirmed' as Commitment;
const PROGRAM_ID = new PublicKey(process.env.CORRIDOR_PROGRAM_ID!);

// IDL snippet for SwapOccurred
type SwapOccurredEvent = { swapType: string; qty: string; price: string };
const IDL = { events: [ { name: 'SwapOccurred', fields: [ { name: 'swapType', type: 'string', index: false }, { name: 'qty', type: 'u64', index: false }, { name: 'price', type: 'u64', index: false } ] } ] };
const coder = new EventCoder(IDL);
const connection = new Connection(RPC_URL, COMMITMENT);

export async function startEventListener(prisma: PrismaClient) {
  connection.onLogs(PROGRAM_ID, async (logInfo) => {
    try {
      const parsed = coder.parse(logInfo.logs.join('\n'));
      if (parsed?.event.name === 'SwapOccurred') {
        const { price } = parsed.event.data as any as SwapOccurredEvent;
        const lowerBound = parseFloat(process.env.PRICE_LOWER!);
        const upperBound = parseFloat(process.env.PRICE_UPPER!);
        await prisma.priceBand.create({ data: {
          currentPrice: price,
          lowerBound: lowerBound.toString(),
          upperBound: upperBound.toString(),
          timestamp: new Date()
        }});
        console.log('Stored new priceBand record at price', price);
      }
    } catch {
      // ignore non-matching logs
    }
  });
}
