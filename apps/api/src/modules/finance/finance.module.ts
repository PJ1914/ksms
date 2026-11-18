import { Module } from '@nestjs/common';
import { CashbookService } from './cashbook.service';

/** Layer L2 (Finance): cashbook now; expenses and daily closing arrive in Phase 12. */
@Module({
  providers: [CashbookService],
  exports: [CashbookService],
})
export class FinanceModule {}
