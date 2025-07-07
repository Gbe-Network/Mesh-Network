// File: api-indexer/src/index.ts
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { startEventListener } from './eventListener';

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

// REST endpoint for PriceBand data
overlayPriceBand();
app.get('/api/price-band', async (req, res) => {
  try {
    const record = await prisma.priceBand.findFirst({ orderBy: { timestamp: 'desc' }});
    if (!record) return res.status(404).json({ error: 'No price band data' });
    res.json({
      currentPrice: parseFloat(record.currentPrice),
      lowerBound: parseFloat(record.lowerBound),
      upperBound: parseFloat(record.upperBound),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`API Indexer listening at http://localhost:${port}`);
  startEventListener(prisma).catch(err => console.error(err));
});
