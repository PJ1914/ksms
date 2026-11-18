import { AppException } from '../../common/errors/app.exception';
import type { Prisma } from '../../generated/prisma/client';

type Tx = Prisma.TransactionClient;

export interface LockedSale {
  id: string;
  status: 'COMPLETED' | 'CANCELLED';
  saleNumber: string;
  customerId: string | null;
  /** India-time calendar day the sale was made (YYYY-MM-DD). */
  soldOn: string;
}

/**
 * Locks one sale of this shop AND branch (FOR NO KEY UPDATE) and returns its state. Another branch's or another
 * shop's sale is simply "not found". Lock order in Sales: sale -> stock -> document number -> customer.
 * NO KEY UPDATE serialises cancellations and returns of the same sale without blocking foreign-key checks.
 */
export async function lockSale(
  tx: Tx,
  scope: { organizationId: string; branchId: string },
  saleId: string,
): Promise<LockedSale> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      status: LockedSale['status'];
      sale_number: string;
      customer_id: string | null;
      sold_on: string;
    }[]
  >`
    SELECT id, status::text AS status, sale_number, customer_id,
           to_char(sold_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS sold_on
    FROM sales
    WHERE id = ${saleId}::uuid AND organization_id = ${scope.organizationId}::uuid AND branch_id = ${scope.branchId}::uuid
    FOR NO KEY UPDATE`;
  const r = rows[0];
  if (!r) throw new AppException('SALE_NOT_FOUND', 'Sale not found', 404);
  return {
    id: r.id,
    status: r.status,
    saleNumber: r.sale_number,
    customerId: r.customer_id,
    soldOn: r.sold_on,
  };
}
