import { Module } from '@nestjs/common';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';

/** Shop-side subscriptions: trial start, own state, plan limits (ADMIN_PANEL.md Phase B). */
@Module({
  controllers: [SubscriptionController],
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
