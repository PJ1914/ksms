import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { FinanceReportsService } from './finance-reports.service';
import { InventoryReportsService } from './inventory-reports.service';
import { PurchaseReportsService } from './purchase-reports.service';
import { ReportingController } from './reporting.controller';
import { SalesReportsService } from './sales-reports.service';

/** Layer L5: read-only aggregations over every other module's tables. It owns no tables and writes nothing. */
@Module({
  controllers: [ReportingController],
  providers: [
    SalesReportsService,
    PurchaseReportsService,
    InventoryReportsService,
    FinanceReportsService,
    DashboardService,
  ],
})
export class ReportingModule {}
