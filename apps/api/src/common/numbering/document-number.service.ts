import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { financialYear } from '../utils/financial-year';

export type DocumentKind = 'INVOICE' | 'RECEIPT' | 'PURCHASE' | 'SALE_RETURN' | 'PURCHASE_RETURN';

/**
 * Gap-free document numbers per shop branch, document kind, series and financial year
 * (e.g. PUR/2026-27/000001). The counter is incremented by ONE atomic UPDATE inside the caller's transaction:
 *  - two simultaneous requests can never get the same number (the row lock makes the second wait);
 *  - if the caller's transaction fails, the increment rolls back with it, so numbers are never wasted.
 */
@Injectable()
export class DocumentNumberService {
  async next(
    tx: Prisma.TransactionClient,
    scope: { organizationId: string; branchId: string },
    kind: DocumentKind,
    series: string,
    date: Date = new Date(),
  ): Promise<{ number: string; sequence: number; series: string; financialYear: string }> {
    const fy = financialYear(date);
    await tx.$executeRaw`
      INSERT INTO document_sequences (id, organization_id, branch_id, document_type, series, financial_year, next_number, updated_at)
      VALUES (gen_random_uuid(), ${scope.organizationId}::uuid, ${scope.branchId}::uuid, ${kind}::"DocumentType", ${series}, ${fy}, 1, now())
      ON CONFLICT (organization_id, branch_id, document_type, series, financial_year) DO NOTHING`;
    const rows = await tx.$queryRaw<{ n: number }[]>`
      UPDATE document_sequences
      SET next_number = next_number + 1, updated_at = now()
      WHERE organization_id = ${scope.organizationId}::uuid AND branch_id = ${scope.branchId}::uuid
        AND document_type = ${kind}::"DocumentType" AND series = ${series} AND financial_year = ${fy}
      RETURNING next_number - 1 AS n`;
    const sequence = Number(rows[0]!.n);
    return {
      number: `${series}/${fy}/${String(sequence).padStart(6, '0')}`,
      sequence,
      series,
      financialYear: fy,
    };
  }
}
