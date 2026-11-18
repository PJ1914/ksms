import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { FinanceModule } from '../finance/finance.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ProcurementReconciliationService } from './procurement-reconciliation.service';
import { PurchaseReturnsService } from './purchase-returns.service';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { SupplierLedgerService } from './supplier-ledger.service';
import { SupplierPaymentsService } from './supplier-payments.service';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

/** Layer: above Inventory and Catalog (it calls their services), below Sales and Reports. */
@Module({
  imports: [CatalogModule, InventoryModule, FinanceModule],
  controllers: [SuppliersController, PurchasesController],
  providers: [
    SuppliersService,
    SupplierLedgerService,
    SupplierPaymentsService,
    PurchasesService,
    PurchaseReturnsService,
    ProcurementReconciliationService,
  ],
  exports: [SupplierLedgerService],
})
export class ProcurementModule {}
