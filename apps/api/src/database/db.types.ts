import type { Prisma } from '../generated/prisma/client';
import type { PrismaService } from './prisma.service';

/** Either the service itself or an interactive-transaction client; lets services join a caller's transaction. */
export type Db = PrismaService | Prisma.TransactionClient;
