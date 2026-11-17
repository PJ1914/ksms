import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../errors/app.exception';

const keySchema = z.uuid();

/** Stable JSON (sorted keys) so the same logical request always hashes the same. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export interface IdempotentResult<T> {
  result: T;
  /** True when this response is the stored result of an earlier identical request. */
  replayed: boolean;
}

/**
 * Exactly-once execution for commands that may be retried (lost responses, double taps, network retries).
 *
 * The key is claimed with `INSERT ... ON CONFLICT DO NOTHING` as the FIRST statement of the same database
 * transaction that performs the work:
 *  - the first request inserts the key, does the work and stores the response, all-or-nothing;
 *  - a concurrent duplicate blocks on the unique index until the first commits, then replays its response;
 *  - if the first request fails (e.g. insufficient stock), its key disappears with the rollback, so a retry
 *    is processed normally;
 *  - the same key with a different payload is refused (422) instead of silently returning the wrong result.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Validates the client's Idempotency-Key header value. */
  requireKey(raw: unknown): string {
    if (raw === undefined || raw === null || raw === '') {
      throw new AppException(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Send an Idempotency-Key header (a UUID generated for this action)',
        400,
      );
    }
    const parsed = keySchema.safeParse(Array.isArray(raw) ? raw[0] : raw);
    if (!parsed.success)
      throw new AppException('IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key must be a UUID', 400);
    return parsed.data;
  }

  async execute<T>(
    organizationId: string,
    key: string,
    endpoint: string,
    payload: unknown,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    const requestHash = createHash('sha256')
      .update(`${endpoint}\n${stableStringify(payload)}`)
      .digest('hex');

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO idempotency_records (id, organization_id, key, endpoint, request_hash, status, expires_at)
        VALUES (gen_random_uuid(), ${organizationId}::uuid, ${key}, ${endpoint}, ${requestHash}, 'IN_PROGRESS', now() + interval '24 hours')
        ON CONFLICT (organization_id, key) DO NOTHING
        RETURNING id`;

      if (claimed.length === 0) {
        const existing = await tx.idempotencyRecord.findUnique({
          where: { organizationId_key: { organizationId, key } },
          select: { endpoint: true, requestHash: true, status: true, responseBody: true },
        });
        if (!existing || existing.endpoint !== endpoint || existing.requestHash !== requestHash) {
          throw new AppException(
            'IDEMPOTENCY_KEY_REUSED',
            'This Idempotency-Key was already used for a different request',
            422,
          );
        }
        if (existing.status !== 'COMPLETED') {
          throw new AppException(
            'IDEMPOTENCY_IN_PROGRESS',
            'The original request is still being processed; retry shortly',
            409,
          );
        }
        return { result: existing.responseBody as T, replayed: true };
      }

      const result = await work(tx);
      await tx.idempotencyRecord.update({
        where: { id: claimed[0]!.id },
        data: {
          status: 'COMPLETED',
          responseStatus: 201,
          responseBody: JSON.parse(JSON.stringify(result ?? null)) as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
      return { result, replayed: false };
    });
  }
}
