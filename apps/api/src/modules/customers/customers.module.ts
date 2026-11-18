import { Module } from '@nestjs/common';
import { CustomerLedgerService } from './customer-ledger.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

/** Layer L2 (Customer Accounts). Sales post credit through CustomerLedgerService; khata screens come in Phase 11. */
@Module({
  controllers: [CustomersController],
  providers: [CustomersService, CustomerLedgerService],
  exports: [CustomersService, CustomerLedgerService],
})
export class CustomersModule {}
