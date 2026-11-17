import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { InventoryController } from './inventory.controller';
import { InventoryQueriesService } from './inventory-queries.service';
import { InventoryService } from './inventory.service';
import { StockAdjustmentsService } from './stock-adjustments.service';

@Module({
  imports: [CatalogModule],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryQueriesService, StockAdjustmentsService],
  // Procurement and Sales move stock ONLY through InventoryService.
  exports: [InventoryService, InventoryQueriesService],
})
export class InventoryModule {}
