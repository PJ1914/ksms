import { Module } from '@nestjs/common';
import { CashbookQueryService } from './cashbook-query.service';
import { CashbookService } from './cashbook.service';
import { DailyClosingService } from './daily-closing.service';
import { ExpensesService } from './expenses.service';
import { FinanceReconciliationService } from './finance-reconciliation.service';
import { FinanceController } from './finance.controller';

@Module({
  controllers: [FinanceController],
  providers: [
    CashbookService,
    ExpensesService,
    CashbookQueryService,
    DailyClosingService,
    FinanceReconciliationService,
  ],
  exports: [
    CashbookService,
    ExpensesService,
    CashbookQueryService,
    DailyClosingService,
    FinanceReconciliationService,
  ],
})
export class FinanceModule {}
