import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { TenantContext } from '../../common/auth/auth.types';
import { RequireBranch, RequirePermission, Tenant } from '../../common/auth/decorators';
import { RolePermissionService } from '../../common/auth/role-permission.service';
import { DashboardService } from './dashboard.service';
import { FinanceReportsService } from './finance-reports.service';
import { InventoryReportsService } from './inventory-reports.service';
import { PurchaseReportsService } from './purchase-reports.service';
import {
  DayBookQuery,
  MoversQuery,
  OutstandingQuery,
  PagedRangeQuery,
  PurchasesBreakdownQuery,
  RangeQuery,
  SalesBreakdownQuery,
  SalesSummaryQuery,
} from './reporting.dto';
import { SalesReportsService } from './sales-reports.service';

/**
 * Read-only reports for the active branch (send `X-Branch-Id`). Controllers hold no logic: they check the role and
 * hand over to the report services. Periods are India-time days, at most 366, default the last 30.
 */
@ApiTags('Reports')
@ApiBearerAuth()
@ApiSecurity('branch')
@RequireBranch()
@Controller('reports')
export class ReportingController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly sales: SalesReportsService,
    private readonly purchases: PurchaseReportsService,
    private readonly inventory: InventoryReportsService,
    private readonly finance: FinanceReportsService,
    private readonly rolePerms: RolePermissionService,
  ) {}

  @Get('dashboard')
  @RequirePermission('report.financial')
  @ApiOperation({ summary: 'Today at a glance; parts the role may not see are null' })
  async home(@Tenant() t: TenantContext) {
    return this.dashboard.get(t, await this.rolePerms.get(t.roleId));
  }

  // ------------------------------------------------------------------ sales

  @Get('sales/summary')
  @RequirePermission('report.sales')
  @ApiOperation({ summary: 'Sales by day, week or month, net of returns' })
  salesSummary(@Tenant() t: TenantContext, @Query() q: SalesSummaryQuery) {
    return this.sales.summary(t, q);
  }

  @Get('sales/breakdown')
  @RequirePermission('report.sales')
  @ApiOperation({
    summary:
      'Sales by product, category, customer, payment method or cashier (cost and profit need report.profit)',
  })
  async salesBreakdown(@Tenant() t: TenantContext, @Query() q: SalesBreakdownQuery) {
    const perms = await this.rolePerms.get(t.roleId);
    return this.sales.breakdown(t, q, perms.isOwner || perms.keys.has('report.profit'));
  }

  // ------------------------------------------------------------------ purchases

  @Get('purchases/summary')
  @RequirePermission('report.purchases')
  @ApiOperation({ summary: 'Purchases by day, week or month' })
  purchasesSummary(@Tenant() t: TenantContext, @Query() q: SalesSummaryQuery) {
    return this.purchases.summary(t, q);
  }

  @Get('purchases/breakdown')
  @RequirePermission('report.purchases')
  @ApiOperation({ summary: 'Purchases by supplier' })
  purchasesBreakdown(@Tenant() t: TenantContext, @Query() q: PurchasesBreakdownQuery) {
    return this.purchases.bySupplier(t, q);
  }

  // ------------------------------------------------------------------ inventory

  @Get('inventory/summary')
  @RequirePermission('report.inventory')
  @ApiOperation({ summary: 'Stock value, low and out-of-stock counts, expired and expiring stock' })
  inventorySummary(@Tenant() t: TenantContext) {
    return this.inventory.summary(t);
  }

  @Get('inventory/movers')
  @RequirePermission('report.inventory')
  @ApiOperation({ summary: 'Fast sellers, or slow stock that ties up money' })
  inventoryMovers(@Tenant() t: TenantContext, @Query() q: MoversQuery) {
    return this.inventory.movers(t, q);
  }

  // ------------------------------------------------------------------ money

  @Get('finance/profit')
  @RequirePermission('report.profit')
  @ApiOperation({ summary: 'Revenue, gross profit and net profit (estimates) for a period' })
  profit(@Tenant() t: TenantContext, @Query() q: RangeQuery) {
    return this.finance.profitAndLoss(t, q);
  }

  @Get('finance/cash-flow')
  @RequirePermission('report.financial')
  @ApiOperation({ summary: 'Cash book money in and out by mode and kind' })
  cashFlow(@Tenant() t: TenantContext, @Query() q: RangeQuery) {
    return this.finance.cashFlow(t, q);
  }

  @Get('finance/outstanding')
  @RequirePermission('report.financial')
  @ApiOperation({ summary: 'Who owes the shop (khata) or whom the shop owes' })
  outstanding(@Tenant() t: TenantContext, @Query() q: OutstandingQuery) {
    return this.finance.outstanding(t, q);
  }

  @Get('finance/collections')
  @RequirePermission('report.financial')
  @ApiOperation({ summary: 'Khata collections by agent and by day' })
  collections(@Tenant() t: TenantContext, @Query() q: PagedRangeQuery) {
    return this.finance.collections(t, q);
  }

  @Get('finance/day-book')
  @RequirePermission('report.financial')
  @ApiOperation({ summary: 'Everything that happened on one day' })
  dayBook(@Tenant() t: TenantContext, @Query() q: DayBookQuery) {
    return this.finance.dayBook(t, q);
  }
}
