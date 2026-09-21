import { PrismaClient } from "@prisma/client";

// Single Prisma client per process. Hot reload in dev would otherwise open a new
// pool on every file change.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function createPrismaClient(datasourceUrl?: string): PrismaClient {
  return new PrismaClient({
    datasourceUrl: datasourceUrl ?? process.env.DATABASE_URL,
    log: process.env.PRISMA_LOG === "query" ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
