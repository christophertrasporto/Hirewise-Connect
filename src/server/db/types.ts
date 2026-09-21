// Type-only re-exports so that services and helpers can name a transaction without
// importing @prisma/client directly (INV-A2). This file is the one allowed exception
// to the import boundary because it exports types only.
import type { Prisma, PrismaClient } from "@prisma/client";

export type { Prisma, PrismaClient };
/** A Prisma transaction client, passed through every write in a unit of work. */
export type Tx = Prisma.TransactionClient;
/** Either the root client or a transaction. */
export type Db = PrismaClient | Tx;
