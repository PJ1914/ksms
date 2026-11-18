import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { FinanceModule } from '../finance/finance.module';
import { InventoryModule } from '../inventory/inventory.module';
import { HeldBillsService } from './held-bills.service';
import { SaleCancellationService } from './sale-cancellation.service';
import { SaleReturnsService } from './sale-returns.service';
import { SalesController } from './sales.controller';
import { SalesReconciliationService } from './sales-reconciliation.service';
import { SalesService } from './sales.service';

/** Layer L4 (Sales): uses Catalog (prices), Inventory (stock), Customers (credit) and Finance (cashbook). */
@Module({
  imports: [CatalogModule, InventoryModule, CustomersModule, FinanceModule],
  controllers: [SalesController],
  providers: [
    SalesService,
    SaleCancellationService,
    SaleReturnsService,
    HeldBillsService,
    SalesReconciliationService,
  ],
})
export class SalesModule {}
