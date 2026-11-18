import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { FinanceModule } from '../finance/finance.module';
import { CollectionAgentsService } from './collection-agents.service';
import { CollectionAgentsController, CollectionsController } from './collections.controller';
import { CollectionsReconciliationService } from './collections-reconciliation.service';
import { CollectionsService } from './collections.service';

@Module({
  imports: [CustomersModule, FinanceModule],
  controllers: [CollectionsController, CollectionAgentsController],
  providers: [CollectionsService, CollectionAgentsService, CollectionsReconciliationService],
  exports: [CollectionsService, CollectionAgentsService, CollectionsReconciliationService],
})
export class CollectionsModule {}
