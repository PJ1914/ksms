import { AppException } from '../../common/errors/app.exception';
import type { Prisma } from '../../generated/prisma/client';

type Tx = Prisma.TransactionClient;

export interface LockedPurchase {
  id: string;
  status: 'DRAFT' | 'CONFIRMED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
  supplierId: string;
  purchaseNumber: string;
  roundOff: string;
  purchaseDate: string;
}

/**
 * Locks one purchase of this shop AND branch (SELECT ... FOR NO KEY UPDATE) and returns its current state.
 * NO KEY UPDATE serialises competing receipts and returns but does not clash with the foreign-key checks of payments
 * being recorded against the purchase (a plain FOR UPDATE would let a receipt and a payment deadlock).
 * Another branch's or another shop's purchase is simply "not found".
 * Lock order in this module: purchase -> stock (inventory engine) -> supplier ledger.
 */
export async function lockPurchase(
  tx: Tx,
  scope: { organizationId: string; branchId: string },
  purchaseId: string,
): Promise<LockedPurchase> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      status: LockedPurchase['status'];
      supplier_id: string;
      purchase_number: string;
      round_off: string;
      purchase_date: string;
    }[]
  >`
    SELECT id, status::text AS status, supplier_id, purchase_number, round_off::text AS round_off,
           to_char(purchase_date, 'YYYY-MM-DD') AS purchase_date
    FROM purchases
    WHERE id = ${purchaseId}::uuid AND organization_id = ${scope.organizationId}::uuid AND branch_id = ${scope.branchId}::uuid
    FOR NO KEY UPDATE`;
  const r = rows[0];
  if (!r) throw new AppException('PURCHASE_NOT_FOUND', 'Purchase not found', 404);
  return {
    id: r.id,
    status: r.status,
    supplierId: r.supplier_id,
    purchaseNumber: r.purchase_number,
    roundOff: r.round_off,
    purchaseDate: r.purchase_date,
  };
}
