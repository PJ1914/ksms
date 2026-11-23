import { Injectable } from '@nestjs/common';
import type { TenantContext } from '../../common/auth/auth.types';
import type { RolePermissions } from '../../common/auth/role-permission.service';
import { todayInIndia } from '../../common/utils/dates';
import { FinanceReportsService } from './finance-reports.service';
import { InventoryReportsService } from './inventory-reports.service';
import { SalesReportsService } from './sales-reports.service';

const may = (p: RolePermissions, key: string) => p.isOwner || p.keys.has(key);
const firstOfMonth = (today: string) => `${today.slice(0, 8)}01`;

/**
 * The home screen's figures, put together from the same report services the report screens use, so the home screen
 * and the reports can never disagree. A part is left out (null) when the user's role may not see it.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly sales: SalesReportsService,
    private readonly inventory: InventoryReportsService,
    private readonly finance: FinanceReportsService,
  ) {}

  async get(t: TenantContext, perms: RolePermissions) {
    const today = todayInIndia();
    const monthStart = firstOfMonth(today);
    const range = { from: today, to: today };
    const [salesToday, cash, owed, stock, profitToday, profitMonth, salesMonth] = await Promise.all(
      [
        may(perms, 'report.sales') ? this.sales.summary(t, range) : null,
        this.finance.cashFlow(t, range),
        this.finance.outstanding(t, { party: 'customers', pageSize: 1 }),
        may(perms, 'report.inventory') ? this.inventory.summary(t) : null,
        may(perms, 'report.profit') ? this.finance.profitAndLoss(t, range) : null,
        may(perms, 'report.profit')
          ? this.finance.profitAndLoss(t, { from: monthStart, to: today })
          : null,
        may(perms, 'report.sales') ? this.sales.summary(t, { from: monthStart, to: today }) : null,
      ],
    );
    const summary = owed.meta.summary as {
      customers: { owing: number; totalDue: string };
      suppliers: { owed: number; totalPayable: string };
    };
    return {
      date: today,
      sales: salesToday && {
        bills: salesToday.totals.bills,
        billValue: salesToday.totals.billValue,
        netSales: salesToday.totals.netSales,
        returnsValue: salesToday.totals.returnsValue,
        creditGiven: salesToday.totals.creditGiven,
        monthToDate: salesMonth && {
          from: monthStart,
          bills: salesMonth.totals.bills,
          netSales: salesMonth.totals.netSales,
        },
      },
      /** Money that moved in the cash book today (all kinds), by payment mode. */
      cashToday: {
        moneyIn: cash.totals.moneyIn,
        moneyOut: cash.totals.moneyOut,
        net: cash.totals.net,
        byMethod: cash.byMethod,
      },
      owed: {
        customersOwing: summary.customers.owing,
        customerDue: summary.customers.totalDue,
        suppliersOwed: summary.suppliers.owed,
        supplierPayable: summary.suppliers.totalPayable,
      },
      stock: stock && {
        stockValue: stock.stockValue,
        lowStockProducts: stock.lowStockProducts,
        productsOutOfStock: stock.productsOutOfStock,
        expiringSoon: stock.expiringSoon,
        expired: stock.expired,
      },
      profit: profitToday && {
        today: { grossProfit: profitToday.grossProfit, netProfit: profitToday.netProfit },
        monthToDate: profitMonth && {
          from: monthStart,
          revenue: profitMonth.revenue,
          grossProfit: profitMonth.grossProfit,
          expenses: profitMonth.expenses.total,
          netProfit: profitMonth.netProfit,
        },
        isEstimate: true,
      },
    };
  }
}
