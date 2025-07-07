// File: api-indexer/src/dbClient.ts
import { PrismaClient } from '@prisma/client';

// Singleton pattern for PrismaClient
let prisma: PrismaClient;

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}
